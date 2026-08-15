const mongoose = require('mongoose');
const Product = require('./Product');
const Reservation = require('./Reservation');
const { publishEvent } = require('./rabbit');

// Reserves stock for a newly created order. Runs as a side effect of
// order.created - independent of, and in parallel with, Payment Service
// processing the same event.
//
// Note: stock is never allowed to go below 0 here (clamped), which means
// in rare cases the "reservation" can under-reserve relative to what was
// requested. Proper inventory locking (rejecting the order outright on
// insufficient stock) is a reasonable next step beyond this project's scope.
async function reserveStock(order) {
  const { orderId, items } = order;

  const existing = await Reservation.findOne({ orderId });
  if (existing) {
    console.log(`[product-service] Order ${orderId} already has a reservation, skipping`);
    return;
  }

  for (const item of items) {
    if (!mongoose.Types.ObjectId.isValid(item.productId)) {
      console.error(`[product-service] Skipping invalid productId in order ${orderId}: ${item.productId}`);
      continue;
    }
    const product = await Product.findById(item.productId);
    if (!product) {
      console.error(`[product-service] Product ${item.productId} not found for order ${orderId}`);
      continue;
    }
    product.stock = Math.max(0, product.stock - item.quantity);
    await product.save();
  }

  await Reservation.create({ orderId, items, status: 'RESERVED' });
  console.log(`[product-service] Reserved stock for order ${orderId}`);
  publishEvent('stock.reserved', { orderId });
}

// Compensating transaction: undoes a stock reservation when payment fails.
async function releaseStock(payload) {
  const { orderId } = payload;

  const reservation = await Reservation.findOne({ orderId, status: 'RESERVED' });
  if (!reservation) {
    console.log(`[product-service] No active reservation found for order ${orderId}, nothing to release`);
    return;
  }

  for (const item of reservation.items) {
    if (!mongoose.Types.ObjectId.isValid(item.productId)) continue;
    const product = await Product.findById(item.productId);
    if (!product) continue;
    product.stock += item.quantity;
    await product.save();
  }

  reservation.status = 'RELEASED';
  await reservation.save();
  console.log(`[product-service] Released stock for order ${orderId} (payment failed)`);
  publishEvent('stock.released', { orderId });
}

module.exports = { reserveStock, releaseStock };