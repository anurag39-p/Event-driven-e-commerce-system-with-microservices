jest.mock('./db', () => ({}));
jest.mock('./reliability', () => ({
  ensureIdempotencyTable: jest.fn(),
  getDlqStatus: jest.fn(),
  replayDlq: jest.fn(),
}));
jest.mock('./rabbit', () => ({
  connectRabbit: jest.fn(),
  publishEvent: jest.fn(),
  startOrderCreatedConsumer: jest.fn(),
  getChannel: jest.fn(),
  getTopology: jest.fn(),
  QUEUE: 'payment-service.order-events',
}));
jest.mock('./mockPayment');

const { publishEvent } = require('./rabbit');
const { processPayment } = require('./mockPayment');
const { handleOrderCreated } = require('./index');

describe('handleOrderCreated - successful payment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('publishes payment.succeeded with the order id and total', async () => {
    processPayment.mockReturnValueOnce({ succeeded: true, reason: null });

    await handleOrderCreated('order.created', { orderId: 55, total: '39.98' });

    expect(publishEvent).toHaveBeenCalledWith('payment.succeeded', { orderId: 55, total: '39.98' });
  });

  test('does not publish payment.failed on success', async () => {
    processPayment.mockReturnValueOnce({ succeeded: true, reason: null });

    await handleOrderCreated('order.created', { orderId: 55, total: '39.98' });

    expect(publishEvent).not.toHaveBeenCalledWith('payment.failed', expect.anything());
  });
});

describe('handleOrderCreated - declined payment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('publishes payment.failed with the order id and decline reason', async () => {
    processPayment.mockReturnValueOnce({ succeeded: false, reason: 'Simulated card decline' });

    await handleOrderCreated('order.created', { orderId: 56, total: '39.98' });

    expect(publishEvent).toHaveBeenCalledWith('payment.failed', { orderId: 56, reason: 'Simulated card decline' });
  });

  test('does not publish payment.succeeded on decline', async () => {
    processPayment.mockReturnValueOnce({ succeeded: false, reason: 'Simulated card decline' });

    await handleOrderCreated('order.created', { orderId: 56, total: '39.98' });

    expect(publishEvent).not.toHaveBeenCalledWith('payment.succeeded', expect.anything());
  });
});

describe('handleOrderCreated - transient failure from processPayment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('propagates the error rather than swallowing it, so the retry/DLQ mechanism can retry the message', async () => {
    processPayment.mockImplementationOnce(() => {
      throw new Error('Simulated payment gateway timeout');
    });

    await expect(
      handleOrderCreated('order.created', { orderId: 57, total: '39.98' })
    ).rejects.toThrow('Simulated payment gateway timeout');

    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe('handleOrderCreated - unrecognized routing key', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws instead of silently processing an unexpected event', async () => {
    await expect(handleOrderCreated('some.other.event', { orderId: 1 })).rejects.toThrow(
      'Unrecognized routing key'
    );

    expect(processPayment).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });
});