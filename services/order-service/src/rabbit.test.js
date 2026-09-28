jest.mock('amqplib');
jest.mock('./reliability', () => ({
  setupRetryTopology: jest.fn().mockResolvedValue({ retryQueue: 'r', dlqQueue: 'd' }),
  createReliableHandler: jest.fn(() => jest.fn()),
  generateMessageId: jest.fn(() => 'fixed-id'),
}));

function makeFakeChannel() {
  return {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn(),
    publish: jest.fn(),
  };
}

function makeFakeConnection(channel) {
  const listeners = {};
  return {
    createChannel: jest.fn().mockResolvedValue(channel),
    on: jest.fn((event, cb) => {
      listeners[event] = cb;
    }),
    _trigger: (event, ...args) => listeners[event] && listeners[event](...args),
  };
}

// jest.resetModules() invalidates any module reference captured before it
// ran - rabbit.js would end up requiring a *different* amqplib mock
// instance than one grabbed at file-load time. Always re-require both
// together, right after resetModules, so they stay the same instance.
function freshRabbit() {
  jest.resetModules();
  const amqp = require('amqplib');
  const rabbit = require('./rabbit');
  return { amqp, rabbit };
}

describe('rabbit.js - publishEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws (does not silently no-op) when the channel is not ready', () => {
    const { rabbit } = freshRabbit();
    expect(() => rabbit.publishEvent('order.created', {})).toThrow(/channel not ready/i);
  });

  test('publishes with the given options.messageId instead of generating a new one', async () => {
    const { amqp, rabbit } = freshRabbit();
    const channel = makeFakeChannel();
    amqp.connect.mockResolvedValue(makeFakeConnection(channel));

    await rabbit.connectRabbit();
    rabbit.publishEvent('order.created', { orderId: 1 }, { messageId: 'reused-id' });

    expect(channel.publish).toHaveBeenCalledWith(
      'ecommerce_events',
      'order.created',
      expect.any(Buffer),
      expect.objectContaining({ messageId: 'reused-id' })
    );
  });
});

describe('rabbit.js - reconnect on connection close', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  test('re-runs the onConnected callback after the initial connect', async () => {
    const { amqp, rabbit } = freshRabbit();
    amqp.connect.mockResolvedValue(makeFakeConnection(makeFakeChannel()));

    const setup = jest.fn().mockResolvedValue(undefined);
    rabbit.onConnected(setup);
    await rabbit.connectRabbit();

    expect(setup).toHaveBeenCalledTimes(1);
  });

  test('a dropped connection clears the channel, then reconnecting re-runs onConnected again', async () => {
    const { amqp, rabbit } = freshRabbit();
    const channelA = makeFakeChannel();
    const connectionA = makeFakeConnection(channelA);
    const channelB = makeFakeChannel();
    const connectionB = makeFakeConnection(channelB);
    amqp.connect.mockResolvedValueOnce(connectionA).mockResolvedValueOnce(connectionB);

    const setup = jest.fn().mockResolvedValue(undefined);
    rabbit.onConnected(setup);

    await rabbit.connectRabbit();
    expect(rabbit.getChannel()).toBe(channelA);
    expect(setup).toHaveBeenCalledTimes(1);

    // Simulate RabbitMQ dropping the connection.
    connectionA._trigger('close');
    expect(rabbit.getChannel()).toBeNull();

    // publishEvent must throw during the gap, not silently succeed - a
    // silent success here would make the outbox relay wrongly mark an
    // event as published when it never left the process.
    expect(() => rabbit.publishEvent('order.created', {})).toThrow(/channel not ready/i);

    // Advance past the reconnect delay and flush the microtask queue.
    await jest.advanceTimersByTimeAsync(3100);

    expect(rabbit.getChannel()).toBe(channelB);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  test('keeps retrying indefinitely if a reconnect attempt exhausts its own retries, rather than giving up', async () => {
    const { amqp, rabbit } = freshRabbit();
    const channelA = makeFakeChannel();
    const connectionA = makeFakeConnection(channelA);
    const channelB = makeFakeChannel();
    const connectionB = makeFakeConnection(channelB);

    // Initial connect succeeds. Then the next 10 attempts (one full
    // connectRabbit() retry cycle) all fail, simulating an outage longer
    // than the ~30s a single cycle covers. The 11th attempt succeeds.
    amqp.connect.mockResolvedValueOnce(connectionA);
    for (let i = 0; i < 10; i++) {
      amqp.connect.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND rabbitmq'));
    }
    amqp.connect.mockResolvedValueOnce(connectionB);

    const setup = jest.fn().mockResolvedValue(undefined);
    rabbit.onConnected(setup);

    await rabbit.connectRabbit();
    connectionA._trigger('close');

    // 3s initial reconnect delay + 10 * 3s retry-loop delay + 3s before
    // the next reconnect cycle starts.
    await jest.advanceTimersByTimeAsync(3000 + 10 * 3000 + 3000 + 500);

    expect(rabbit.getChannel()).toBe(channelB);
    expect(setup).toHaveBeenCalledTimes(2); // once for connectionA, once for connectionB
  });
});
