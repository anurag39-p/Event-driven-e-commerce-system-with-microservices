const { claimEvent, setupRetryTopology, createReliableHandler, getDlqStatus, replayDlq, generateMessageId } = require('./reliability');

// The reliable handler claims each message inside a transaction on a client
// checked out of the pool. `claim: false` simulates the INSERT ... ON CONFLICT
// DO NOTHING inserting nothing (the message was already claimed).
function buildPool({ claim = true } = {}) {
  const client = {
    query: jest.fn(async (sql) => (/INSERT INTO processed_events/.test(sql) ? { rowCount: claim ? 1 : 0 } : {})),
    on: jest.fn(),
    removeListener: jest.fn(),
    release: jest.fn(),
  };
  return { connect: jest.fn().mockResolvedValue(client), client };
}

const sqlCalls = (client) => client.query.mock.calls.map(([sql]) => sql);

function buildChannel() {
  return {
    assertQueue: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn(),
    checkQueue: jest.fn(),
    get: jest.fn(),
  };
}

function buildMessage({ routingKey = 'order.created', payload = {}, messageId = 'msg-1', headers = {} } = {}) {
  return {
    properties: { messageId, headers },
    fields: { routingKey },
    content: Buffer.from(JSON.stringify(payload)),
  };
}

describe('generateMessageId', () => {
  test('returns a string, and a different value on each call (uniqueness)', () => {
    const a = generateMessageId();
    const b = generateMessageId();

    expect(typeof a).toBe('string');
    expect(a).not.toBe(b);
  });
});

describe('claimEvent', () => {
  test('returns true when the insert added a row (we own the message)', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rowCount: 1 }) };
    expect(await claimEvent(client, 'm1', 'order-service')).toBe(true);
  });

  test('returns false when ON CONFLICT DO NOTHING inserted nothing (already claimed)', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rowCount: 0 }) };
    expect(await claimEvent(client, 'm1', 'order-service')).toBe(false);
  });

  test('is a single atomic INSERT ... ON CONFLICT (message_id, service_name) DO NOTHING, scoped by both keys', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rowCount: 1 }) };

    await claimEvent(client, 'm1', 'order-service');

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO processed_events/);
    expect(sql).toMatch(/ON CONFLICT \(message_id, service_name\) DO NOTHING/);
    expect(sql).not.toMatch(/SELECT/i);
    expect(params).toEqual(['m1', 'order-service']);
  });
});

describe('setupRetryTopology', () => {
  test('creates a retry queue and a DLQ, and returns their names', async () => {
    const channel = buildChannel();

    const topology = await setupRetryTopology(channel, 'payment-service.order-events');

    expect(topology).toEqual({
      retryQueue: 'payment-service.order-events.retry',
      dlqQueue: 'payment-service.order-events.dlq',
    });
    expect(channel.assertQueue).toHaveBeenCalledWith(
      'payment-service.order-events.retry',
      expect.objectContaining({
        arguments: expect.objectContaining({
          'x-dead-letter-routing-key': 'payment-service.order-events',
        }),
      })
    );
    expect(channel.assertQueue).toHaveBeenCalledWith('payment-service.order-events.dlq', { durable: true });
  });
});

describe('createReliableHandler', () => {
  const serviceName = 'payment-service';
  const queueName = 'payment-service.order-events';
  const retryQueue = `${queueName}.retry`;
  const dlqQueue = `${queueName}.dlq`;

  function buildHandlerDeps({ pool, channel, handler }) {
    return createReliableHandler({ channel, pool, serviceName, queueName, retryQueue, dlqQueue, handler });
  }

  test('caps in-flight messages via channel.prefetch so claims cannot exhaust the connection pool', () => {
    const channel = buildChannel();
    buildHandlerDeps({ pool: buildPool(), channel, handler: jest.fn() });
    expect(channel.prefetch).toHaveBeenCalledWith(4);
  });

  test('does nothing when given a null message', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn();
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });

    await reliableHandler(null);

    expect(handler).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
  });

  test('duplicate messages are acked without calling the handler, and the connection is returned', async () => {
    const pool = buildPool({ claim: false });
    const channel = buildChannel();
    const handler = jest.fn();
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ messageId: 'm1' });

    await reliableHandler(msg);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(sqlCalls(pool.client)).toEqual(['BEGIN', expect.stringContaining('INSERT INTO processed_events'), 'ROLLBACK']);
    expect(pool.client.release).toHaveBeenCalledWith(false);
  });

  test('happy path: claims, runs the handler with routing key + parsed payload, COMMITs, and only then acks', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn().mockResolvedValue(undefined);
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ routingKey: 'order.created', payload: { orderId: 5 }, messageId: 'm2' });

    await reliableHandler(msg);

    expect(handler).toHaveBeenCalledWith('order.created', { orderId: 5 });
    expect(sqlCalls(pool.client)).toEqual(['BEGIN', expect.stringContaining('INSERT INTO processed_events'), 'COMMIT']);

    const commitOrder = pool.client.query.mock.invocationCallOrder[2];
    const ackOrder = channel.ack.mock.invocationCallOrder[0];
    expect(commitOrder).toBeLessThan(ackOrder); // a crash between the two only causes a harmless redelivery
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(pool.client.release).toHaveBeenCalledWith(false);
  });

  test('the handler only runs after the claim succeeds (claim happens first)', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn().mockResolvedValue(undefined);
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });

    await reliableHandler(buildMessage());

    const claimOrder = pool.client.query.mock.invocationCallOrder[1];
    expect(claimOrder).toBeLessThan(handler.mock.invocationCallOrder[0]);
  });

  test('uses the preserved x-original-routing-key header on a redelivered message, not the delivery routing key', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn().mockResolvedValue(undefined);
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({
      routingKey: queueName,
      payload: { orderId: 5 },
      messageId: 'm3',
      headers: { 'x-original-routing-key': 'order.created', 'x-retry-count': 1 },
    });

    await reliableHandler(msg);

    expect(handler).toHaveBeenCalledWith('order.created', { orderId: 5 });
  });

  test('falls back to messageId "unknown" if the message has none', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn().mockResolvedValue(undefined);
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ messageId: undefined });
    delete msg.properties.messageId;

    await reliableHandler(msg);

    expect(pool.client.query).toHaveBeenNthCalledWith(2, expect.any(String), ['unknown', serviceName]);
  });

  test('on handler failure the claim is ROLLED BACK (never committed), so the retry is not mistaken for a duplicate', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn().mockRejectedValue(new Error('Simulated payment gateway timeout'));
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });

    await reliableHandler(buildMessage({ messageId: 'm4' }));

    expect(sqlCalls(pool.client)).toContain('ROLLBACK');
    expect(sqlCalls(pool.client)).not.toContain('COMMIT');
    expect(pool.client.release).toHaveBeenCalledWith(false);
  });

  test('on handler failure below the retry limit, requeues to the retry queue with an incremented retry count and preserved original routing key', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn().mockRejectedValue(new Error('Simulated payment gateway timeout'));
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ routingKey: 'order.created', messageId: 'm4', headers: { 'x-retry-count': 0 } });

    await reliableHandler(msg);

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      retryQueue,
      msg.content,
      expect.objectContaining({
        messageId: 'm4',
        headers: expect.objectContaining({
          'x-retry-count': 1,
          'x-original-routing-key': 'order.created',
        }),
      })
    );
    expect(channel.sendToQueue).not.toHaveBeenCalledWith(dlqQueue, expect.anything(), expect.anything());
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  test('on the final allowed attempt, handler failure sends to the DLQ instead of retrying again', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn().mockRejectedValue(new Error('Simulated payment gateway timeout'));
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ routingKey: 'order.created', messageId: 'm5', headers: { 'x-retry-count': 2 } });

    await reliableHandler(msg);

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      dlqQueue,
      msg.content,
      expect.objectContaining({
        messageId: 'm5',
        headers: expect.objectContaining({
          'x-retry-count': 3,
          'x-last-error': 'Simulated payment gateway timeout',
        }),
      })
    );
    expect(channel.sendToQueue).not.toHaveBeenCalledWith(retryQueue, expect.anything(), expect.anything());
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  test('a failed COMMIT is treated as a processing failure and retried, not acked as success', async () => {
    const pool = buildPool();
    pool.client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO processed_events/.test(sql)) return { rowCount: 1 };
      if (sql === 'COMMIT') throw new Error('connection lost');
      return {};
    });
    const channel = buildChannel();
    const reliableHandler = buildHandlerDeps({ pool, channel, handler: jest.fn().mockResolvedValue(undefined) });
    const msg = buildMessage({ messageId: 'm6' });

    await reliableHandler(msg);

    expect(channel.sendToQueue).toHaveBeenCalledWith(retryQueue, msg.content, expect.anything());
  });

  test('if ROLLBACK itself fails, the broken connection is destroyed rather than returned to the pool', async () => {
    const pool = buildPool();
    pool.client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO processed_events/.test(sql)) return { rowCount: 1 };
      if (sql === 'ROLLBACK') throw new Error('connection terminated');
      return {};
    });
    const channel = buildChannel();
    const reliableHandler = buildHandlerDeps({ pool, channel, handler: jest.fn().mockRejectedValue(new Error('boom')) });

    await reliableHandler(buildMessage());

    expect(pool.client.release).toHaveBeenCalledWith(true);
  });

  test('listens for errors on the checked-out client (a dropped DB connection must not crash the process) and cleans up', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const reliableHandler = buildHandlerDeps({ pool, channel, handler: jest.fn().mockResolvedValue(undefined) });

    await reliableHandler(buildMessage());

    expect(pool.client.on).toHaveBeenCalledWith('error', expect.any(Function));
    const listener = pool.client.on.mock.calls[0][1];
    expect(pool.client.removeListener).toHaveBeenCalledWith('error', listener);
  });

  test('a client error event marks the connection for destruction instead of throwing', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn(async () => {
      const listener = pool.client.on.mock.calls[0][1];
      expect(() => listener(new Error('terminating connection due to administrator command'))).not.toThrow();
    });
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });

    await reliableHandler(buildMessage());

    expect(pool.client.release).toHaveBeenCalledWith(true);
  });
});

describe('getDlqStatus', () => {
  test('returns the queue name and message count', async () => {
    const channel = buildChannel();
    channel.checkQueue.mockResolvedValueOnce({ messageCount: 4 });

    const status = await getDlqStatus(channel, 'payment-service.order-events.dlq');

    expect(status).toEqual({ queue: 'payment-service.order-events.dlq', messageCount: 4 });
  });
});

describe('replayDlq', () => {
  test('requeues every message from the DLQ back to the main queue, resetting the retry count', async () => {
    const channel = buildChannel();
    const msg1 = buildMessage({ messageId: 'a' });
    const msg2 = buildMessage({ messageId: 'b' });
    channel.get
      .mockResolvedValueOnce(msg1)
      .mockResolvedValueOnce(msg2)
      .mockResolvedValueOnce(null);

    const replayed = await replayDlq(channel, 'payment-service.order-events.dlq', 'payment-service.order-events');

    expect(replayed).toBe(2);
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'payment-service.order-events',
      msg1.content,
      expect.objectContaining({ headers: expect.objectContaining({ 'x-retry-count': 0 }) })
    );
    expect(channel.ack).toHaveBeenCalledWith(msg1);
    expect(channel.ack).toHaveBeenCalledWith(msg2);
  });

  test('stops early when the DLQ is empty, without requiring the caller to know the exact count', async () => {
    const channel = buildChannel();
    channel.get.mockResolvedValueOnce(null);

    const replayed = await replayDlq(channel, 'dlq', 'main-queue');

    expect(replayed).toBe(0);
    expect(channel.sendToQueue).not.toHaveBeenCalled();
  });

  test('never replays more than the given limit in a single call', async () => {
    const channel = buildChannel();
    channel.get.mockResolvedValue(buildMessage({ messageId: 'x' }));

    const replayed = await replayDlq(channel, 'dlq', 'main-queue', 3);

    expect(replayed).toBe(3);
    expect(channel.get).toHaveBeenCalledTimes(3);
  });
});