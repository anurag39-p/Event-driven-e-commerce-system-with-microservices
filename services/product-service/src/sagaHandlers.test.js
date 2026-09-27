jest.mock('./Product');
jest.mock('./Reservation');
jest.mock('./rabbit', () => ({ publishEvent: jest.fn() }));

const mongoose = require('mongoose');
const Product = require('./Product');
const Reservation = require('./Reservation');
const { publishEvent } = require('./rabbit');
const { reserveStock, releaseStock } = require('./sagaHandlers');

const PRODUCT_A = new mongoose.Types.ObjectId().toString();
const PRODUCT_B = new mongoose.Types.ObjectId().toString();

function order(overrides = {}) {
  return {
    orderId: 1,
    items: [{ productId: PRODUCT_A, quantity: 2 }],
    ...overrides,
  };
}

describe('reserveStock', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does nothing if a reservation for this order already exists (idempotent on redelivery)', async () => {
    Reservation.findOne.mockResolvedValue({ orderId: 1 });

    await reserveStock(order());

    expect(Product.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('decrements stock atomically and records a RESERVED reservation on success', async () => {
    Reservation.findOne.mockResolvedValue(null);
    Product.findOneAndUpdate.mockResolvedValue({ _id: PRODUCT_A, stock: 3 });

    await reserveStock(order());

    expect(Product.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: PRODUCT_A, stock: { $gte: 2 } },
      { $inc: { stock: -2 } },
      { new: true }
    );
    expect(Reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 1, status: 'RESERVED' })
    );
    expect(publishEvent).toHaveBeenCalledWith('stock.reserved', { orderId: 1 });
  });

  test('rejects the order when the conditional update matches nothing (insufficient stock)', async () => {
    Reservation.findOne.mockResolvedValue(null);
    Product.findOneAndUpdate.mockResolvedValue(null); // condition failed: not enough stock
    Product.findById.mockResolvedValue({ name: 'Widget', stock: 1 });

    await reserveStock(order({ items: [{ productId: PRODUCT_A, quantity: 5 }] }));

    expect(Reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 1, status: 'FAILED' })
    );
    expect(publishEvent).toHaveBeenCalledWith(
      'stock.reservation.failed',
      expect.objectContaining({ orderId: 1, reason: expect.stringContaining('Insufficient stock') })
    );
  });

  test('rolls back earlier items in the same order when a later item fails (all-or-nothing)', async () => {
    Reservation.findOne.mockResolvedValue(null);
    Product.findOneAndUpdate
      .mockResolvedValueOnce({ _id: PRODUCT_A, stock: 3 }) // item A reserved fine
      .mockResolvedValueOnce(null); // item B fails
    Product.findById.mockResolvedValue({ name: 'Gadget', stock: 0 });

    await reserveStock(order({
      items: [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_B, quantity: 10 },
      ],
    }));

    // Rollback restores the +2 taken from product A.
    expect(Product.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: PRODUCT_A },
      { $inc: { stock: 2 } }
    );
    expect(publishEvent).toHaveBeenCalledWith('stock.reservation.failed', expect.objectContaining({ orderId: 1 }));
    // Never got to a RESERVED reservation.
    expect(Reservation.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });

  test('rejects and does not touch stock when a productId is not a valid ObjectId', async () => {
    Reservation.findOne.mockResolvedValue(null);

    await reserveStock(order({ items: [{ productId: 'not-an-id', quantity: 1 }] }));

    expect(Product.findOneAndUpdate).not.toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith(
      'stock.reservation.failed',
      expect.objectContaining({ reason: expect.stringContaining('Invalid productId') })
    );
  });
});

describe('releaseStock', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does nothing if there is no RESERVED reservation for the order', async () => {
    Reservation.findOne.mockResolvedValue(null);

    await releaseStock({ orderId: 1 });

    expect(Product.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('restores stock for every item and marks the reservation RELEASED', async () => {
    const reservation = {
      orderId: 1,
      items: [{ productId: PRODUCT_A, quantity: 2 }],
      status: 'RESERVED',
      save: jest.fn().mockResolvedValue(undefined),
    };
    Reservation.findOne.mockResolvedValue(reservation);

    await releaseStock({ orderId: 1 });

    expect(Product.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: PRODUCT_A },
      { $inc: { stock: 2 } }
    );
    expect(reservation.status).toBe('RELEASED');
    expect(reservation.save).toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith('stock.released', { orderId: 1 });
  });
});
