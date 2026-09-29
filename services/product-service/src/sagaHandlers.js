const mongoose = require('mongoose');
const Product = require('./Product');
const Reservation = require('./Reservation');
const { publishEvent } = require('./rabbit');

// Atomically decrements stock only if enough is available. The query
// condition (stock >= quantity) and the $inc happen as a single Mongo
// operation, so two concurrent reservations for the same product can't
// both read "5 in stock" and both succeed in taking the last few units -
// whichever gets there first wins, and the other sees no matching
// document and fails cleanly. Returns the updated product, or null if
// the product doesn't exist or didn't have enough stock.
async function tryDecrementStock(productId, quantity) {
  return Product.findOneAndUpdate(
    { _id: productId, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
    { new: true }
  );
}

async function restoreStock(productId, quantity) {
  await Product.findOneAndUpdate({ _id: productId }, { $inc: { stock: quantity } });
}

// Reserves stock for a newly created order. Runs as a side effect of
// order.created - independent of, and in parallel with, Payment Service
// processing the same event.
//
// This is all-or-nothing: if any item in the order can't be reserved
// (product missing, or insufficient stock), everything already reserved
// for this same order is rolled back and stock.reservation.failed is
// published so Order Service can cancel the order instead of confirming
// one it can't fulfil.
async function reserveStock(order) {
  const { orderId, items } = order;

  const existing = await Reservation.findOne({ orderId });
  if (existing) {
    console.log(`[product-service] Order ${orderId} already has a reservation, skipping`);
    return;
  }

  const reservedSoFar = [];

  async function rejectOrder(reason) {
    for (const { productId, quantity } of reservedSoFar) {
      await restoreStock(productId, quantity);
    }
    await Reservation.create({ orderId, items, status: 'FAILED' });
    console.error(`[product-service] Stock reservation failed for order ${orderId}: ${reason}`);
    publishEvent('stock.reservation.failed', { orderId, reason });
  }

  for (const item of items) {
    if (!mongoose.Types.ObjectId.isValid(item.productId)) {
      await rejectOrder(`Invalid productId: ${item.productId}`);
      return;
    }

    const updated = await tryDecrementStock(item.productId, item.quantity);
    if (!updated) {
      const product = await Product.findById(item.productId);
      const reason = product
        ? `Insufficient stock for "${product.name}" (requested ${item.quantity}, available ${product.stock})`
        : `Product ${item.productId} not found`;
      await rejectOrder(reason);
      return;
    }

    reservedSoFar.push({ productId: item.productId, quantity: item.quantity });
  }

  try {
    await Reservation.create({ orderId, items, status: 'RESERVED' });
  } catch (err) {
    // orderId is unique. If a release tombstone (see releaseStock) was
    // written for this order between our initial check and now, the order
    // was already cancelled - give back what we just took and stop.
    if (err.code === 11000) {
      for (const { productId, quantity } of reservedSoFar) {
        await restoreStock(productId, quantity);
      }
      console.log(`[product-service] Order ${orderId} was released while reserving - rolled back`);
      return;
    }
    throw err;
  }
  console.log(`[product-service] Reserved stock for order ${orderId}`);
  publishEvent('stock.reserved', { orderId });
}

// Compensating transaction: undoes a stock reservation when payment fails.
async function releaseStock(payload) {
  const { orderId } = payload;

  const reservation = await Reservation.findOne({ orderId, status: 'RESERVED' });
  if (!reservation) {
    const existing = await Reservation.findOne({ orderId });
    if (existing) {
      console.log(`[product-service] Order ${orderId} reservation already ${existing.status}, nothing to release`);
      return;
    }

    // payment.failed can be processed BEFORE order.created for the same
    // order (e.g. order.created was retried after a failure). Without a
    // marker, the late reserveStock would then reserve stock for an order
    // that is already cancelled, and nothing would ever release it. The
    // unique orderId index makes this marker double as the guard:
    // reserveStock skips any order that already has a reservation row.
    try {
      await Reservation.create({ orderId, items: [], status: 'RELEASED' });
    } catch (err) {
      if (err.code === 11000) {
        // A reservation appeared while we were checking - throw so the
        // retry logic re-runs this and releases the real reservation.
        throw new Error(`Reservation for order ${orderId} appeared during release, retrying`);
      }
      throw err;
    }
    console.log(`[product-service] payment.failed for order ${orderId} arrived before its reservation - marked released so it won't be reserved`);
    return;
  }

  for (const item of reservation.items) {
    if (!mongoose.Types.ObjectId.isValid(item.productId)) continue;
    await restoreStock(item.productId, item.quantity);
  }

  reservation.status = 'RELEASED';
  await reservation.save();
  console.log(`[product-service] Released stock for order ${orderId} (payment failed)`);
  publishEvent('stock.released', { orderId });
}

module.exports = { reserveStock, releaseStock, tryDecrementStock, restoreStock };