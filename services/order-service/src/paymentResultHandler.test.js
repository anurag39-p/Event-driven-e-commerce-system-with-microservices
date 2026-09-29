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

// By default the transition is applied, so updateOrderStatus returns the row.
// Tests for late events override this with null (transition refused).
beforeEach(() => {
  updateOrderStatus.mockResolvedValue({ id: 1, status: 'CONFIRMED', cancellation_reason: null });
});

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

describe('handlePaymentResult - stock reservation failure', () => {
  beforeEach(() => jest.clearAllMocks());

  const reason = 'Insufficient stock for "Widget" (requested 5, available 1)';

  test('cancels the order with the stock-shortfall reason, same as a payment failure', async () => {
    await handlePaymentResult('stock.reservation.failed', { orderId: 12, reason });
    expect(updateOrderStatus).toHaveBeenCalledWith(12, 'CANCELLED', reason);
  });

  test('records a StockReservationFailed timeline event with success=false and the reason', async () => {
    await handlePaymentResult('stock.reservation.failed', { orderId: 12, reason });
    expect(recordEvent).toHaveBeenCalledWith(12, 'StockReservationFailed', 'Product Service', false, reason);
  });

  test('records an OrderCancelled timeline event with the reason', async () => {
    await handlePaymentResult('stock.reservation.failed', { orderId: 12, reason });
    expect(recordEvent).toHaveBeenCalledWith(12, 'OrderCancelled', 'Order Service', true, reason);
  });
});

describe('handlePaymentResult - late events on an order that is already terminal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateOrderStatus.mockResolvedValue(null); // transition refused: order already CONFIRMED/CANCELLED
  });

  test('a late payment.failed still records what arrived, but NOT an OrderCancelled outcome', async () => {
    await handlePaymentResult('payment.failed', { orderId: 20, reason: 'Simulated card decline' });

    expect(updateOrderStatus).toHaveBeenCalledWith(20, 'CANCELLED', 'Simulated card decline');
    expect(recordEvent).toHaveBeenCalledWith(20, 'PaymentFailed', 'Payment Service', false, 'Simulated card decline');
    expect(recordEvent).not.toHaveBeenCalledWith(20, 'OrderCancelled', expect.anything(), expect.anything(), expect.anything());
  });

  test('a late payment.succeeded records PaymentSuccessful but NOT an OrderConfirmed outcome', async () => {
    await handlePaymentResult('payment.succeeded', { orderId: 21, total: '10.00' });

    expect(recordEvent).toHaveBeenCalledWith(21, 'PaymentSuccessful', 'Payment Service', true);
    expect(recordEvent).not.toHaveBeenCalledWith(21, 'OrderConfirmed', expect.anything(), expect.anything());
  });

  test('a late stock.reservation.failed records StockReservationFailed but NOT an OrderCancelled outcome', async () => {
    await handlePaymentResult('stock.reservation.failed', { orderId: 22, reason: 'Insufficient stock' });

    expect(recordEvent).toHaveBeenCalledWith(22, 'StockReservationFailed', 'Product Service', false, 'Insufficient stock');
    expect(recordEvent).not.toHaveBeenCalledWith(22, 'OrderCancelled', expect.anything(), expect.anything(), expect.anything());
  });

  test.each([
    ['payment.succeeded', { orderId: 1, total: '1.00' }],
    ['payment.failed', { orderId: 1, reason: 'x' }],
    ['stock.reservation.failed', { orderId: 1, reason: 'x' }],
  ])('%s on a terminal order resolves normally - throwing would send a stale event through retries into the DLQ', async (key, payload) => {
    await expect(handlePaymentResult(key, payload)).resolves.toBeUndefined();
  });
});
