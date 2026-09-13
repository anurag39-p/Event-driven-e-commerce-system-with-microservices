const { isDuplicate, markProcessed, setupRetryTopology, createReliableHandler, getDlqStatus, replayDlq, generateMessageId } = require('./reliability');

function buildPool() {
  return { query: jest.fn() };
}

function buildChannel() {
  return {
    assertQueue: jest.fn().mockResolvedValue(undefined),
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

describe('isDuplicate', () => {
  test('returns true when a matching row already exists', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({ rows: [{ message_id: 'm1' }] });

    const result = await isDuplicate(pool, 'm1', 'order-service');

    expect(result).toBe(true);
  });

  test('returns false when no matching row exists', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await isDuplicate(pool, 'm1', 'order-service');

    expect(result).toBe(false);
  });

  test('scopes the check by BOTH message_id and service_name', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({ rows: [] });

    await isDuplicate(pool, 'm1', 'order-service');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('service_name'),
      ['m1', 'order-service']
    );
  });
});

describe('markProcessed', () => {
  test('inserts with ON CONFLICT on the composite (message_id, service_name) key', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({});

    await markProcessed(pool, 'm1', 'order-service');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (message_id, service_name)'),
      ['m1', 'order-service']
    );
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

  test('does nothing when given a null message', async () => {
    const pool = buildPool();
    const channel = buildChannel();
    const handler = jest.fn();
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });

    await reliableHandler(null);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
  });

  test('duplicate messages are acked without calling the handler or marking processed again', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({ rows: [{ message_id: 'm1' }] });
    const channel = buildChannel();
    const handler = jest.fn();
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ messageId: 'm1' });

    await reliableHandler(msg);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('happy path: calls the handler with the routing key and parsed payload, marks processed, then acks', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({});
    const channel = buildChannel();
    const handler = jest.fn().mockResolvedValue(undefined);
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ routingKey: 'order.created', payload: { orderId: 5 }, messageId: 'm2' });

    await reliableHandler(msg);

    expect(handler).toHaveBeenCalledWith('order.created', { orderId: 5 });
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  test('uses the preserved x-original-routing-key header on a redelivered message, not the delivery routing key', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({});
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
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({});
    const channel = buildChannel();
    const handler = jest.fn().mockResolvedValue(undefined);
    const reliableHandler = buildHandlerDeps({ pool, channel, handler });
    const msg = buildMessage({ messageId: undefined });
    delete msg.properties.messageId;

    await reliableHandler(msg);

    expect(pool.query).toHaveBeenNthCalledWith(1, expect.any(String), ['unknown', serviceName]);
  });

  test('on handler failure below the retry limit, requeues to the retry queue with an incremented retry count and preserved original routing key', async () => {
    const pool = buildPool();
    pool.query.mockResolvedValueOnce({ rows: [] });
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
    pool.query.mockResolvedValueOnce({ rows: [] });
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