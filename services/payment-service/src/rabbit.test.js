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
// ran - always re-require amqplib and rabbit.js together right after, so
// they stay the same instance.
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
    expect(() => rabbit.publishEvent('payment.succeeded', {})).toThrow(/channel not ready/i);
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

    // Simulate RabbitMQ dropping the connection - this is exactly the real
    // incident: payment-service kept running with a dead channel and
    // never noticed order.created events had stopped arriving.
    connectionA._trigger('close');
    expect(rabbit.getChannel()).toBeNull();
    expect(() => rabbit.publishEvent('payment.succeeded', {})).toThrow(/channel not ready/i);

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

    amqp.connect.mockResolvedValueOnce(connectionA);
    for (let i = 0; i < 10; i++) {
      amqp.connect.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND rabbitmq'));
    }
    amqp.connect.mockResolvedValueOnce(connectionB);

    const setup = jest.fn().mockResolvedValue(undefined);
    rabbit.onConnected(setup);

    await rabbit.connectRabbit();
    connectionA._trigger('close');

    await jest.advanceTimersByTimeAsync(3000 + 10 * 3000 + 3000 + 500);

    expect(rabbit.getChannel()).toBe(channelB);
    expect(setup).toHaveBeenCalledTimes(2);
  });
});
