jest.mock('./db', () => ({}));
jest.mock('./migrate', () => ({ runMigrations: jest.fn() }));
jest.mock('./reliability', () => ({
  ensureIdempotencyTable: jest.fn(),
  getDlqStatus: jest.fn(),
  replayDlq: jest.fn(),
}));
jest.mock('./rabbit', () => ({
  connectRabbit: jest.fn(),
  startPaymentResultConsumer: jest.fn(),
  getChannel: jest.fn(),
  getTopology: jest.fn(),
  QUEUE: 'order-service.payment-results',
}));
jest.mock('./orderStatus');
jest.mock('./orderTimeline');

const { updateOrderStatus } = require('./orderStatus');
const { recordEvent } = require('./orderTimeline');
const { handlePaymentResult } = require('./index');

describe('handlePaymentResult - payment success flow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('changes the order to CONFIRMED', async () => {
    await handlePaymentResult('payment.succeeded', { orderId: 10, total: '99.99' });
    expect(updateOrderStatus).toHaveBeenCalledWith(10, 'CONFIRMED');
  });

  test('records a PaymentSuccessful timeline event', async () => {
    await handlePaymentResult('payment.succeeded', { orderId: 10, total: '99.99' });
    expect(recordEvent).toHaveBeenCalledWith(10, 'PaymentSuccessful', 'Payment Service', true);
  });

  test('records an OrderConfirmed timeline event', async () => {
    await handlePaymentResult('payment.succeeded', { orderId: 10, total: '99.99' });
    expect(recordEvent).toHaveBeenCalledWith(10, 'OrderConfirmed', 'Order Service', true);
  });

  test('records events and updates status in the correct order: PaymentSuccessful, then status update, then OrderConfirmed', async () => {
    await handlePaymentResult('payment.succeeded', { orderId: 10, total: '99.99' });

    const firstRecordCallOrder = recordEvent.mock.invocationCallOrder[0];
    const updateCallOrder = updateOrderStatus.mock.invocationCallOrder[0];
    const secondRecordCallOrder = recordEvent.mock.invocationCallOrder[1];

    expect(firstRecordCallOrder).toBeLessThan(updateCallOrder);
    expect(updateCallOrder).toBeLessThan(secondRecordCallOrder);
  });
});

describe('handlePaymentResult - payment failure flow', () => {
  beforeEach(() => jest.clearAllMocks());

  const reason = 'Simulated card decline';

  test('changes the order to CANCELLED and stores the cancellation reason', async () => {
    await handlePaymentResult('payment.failed', { orderId: 11, reason });
    expect(updateOrderStatus).toHaveBeenCalledWith(11, 'CANCELLED', reason);
  });

  test('records a PaymentFailed timeline event with success=false and the reason', async () => {
    await handlePaymentResult('payment.failed', { orderId: 11, reason });
    expect(recordEvent).toHaveBeenCalledWith(11, 'PaymentFailed', 'Payment Service', false, reason);
  });

  test('records an OrderCancelled timeline event with the reason', async () => {
    await handlePaymentResult('payment.failed', { orderId: 11, reason });
    expect(recordEvent).toHaveBeenCalledWith(11, 'OrderCancelled', 'Order Service', true, reason);
  });
});

describe('handlePaymentResult - unrecognized routing key', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws, so the retry/DLQ mechanism upstream can handle it rather than silently dropping the message', async () => {
    await expect(handlePaymentResult('some.other.event', { orderId: 1 })).rejects.toThrow(
      'Unrecognized routing key'
    );
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });
});