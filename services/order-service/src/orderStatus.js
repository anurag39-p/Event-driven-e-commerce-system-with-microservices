const pool = require('./db');

// An order starts PENDING and may move to exactly one terminal state.
// CONFIRMED and CANCELLED are final: nothing may move an order out of them.
// (Events arrive out of order and get redelivered, so a late
// payment.failed / stock.reservation.failed / payment.succeeded must not be
// able to overwrite an outcome that was already decided.)
const VALID_FROM = {
  CONFIRMED: ['PENDING'],
  CANCELLED: ['PENDING'],
};

// Returns the updated row, or null if nothing was changed - either the order
// doesn't exist or the transition isn't allowed (order already terminal).
// A rejected transition is NOT an error: it must not throw, or the message
// would be retried and dead-lettered for something that can never succeed.
async function updateOrderStatus(orderId, newStatus, reason = null) {
  const allowedFrom = VALID_FROM[newStatus];
  if (!allowedFrom) {
    throw new Error(`Unsupported target status "${newStatus}"`);
  }

  // The rule lives in the WHERE clause so check and write are one atomic
  // statement - a separate SELECT-then-UPDATE would just be another race.
  const result = await pool.query(
    `UPDATE orders SET status = $1, cancellation_reason = $2, updated_at = NOW()
     WHERE id = $3 AND status = ANY($4)
     RETURNING id, status, cancellation_reason`,
    [newStatus, reason, orderId, allowedFrom]
  );

  if (result.rows.length === 1) {
    console.log(`[order-service] Order ${orderId} status updated to ${newStatus}`);
    return result.rows[0];
  }

  // Nothing updated - work out why, purely for the log.
  const current = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  if (current.rows.length === 0) {
    console.error(`[order-service] Tried to update status for unknown order id ${orderId}`);
  } else {
    console.warn(
      `[order-service] Ignored ${newStatus} for order ${orderId}: it is already ${current.rows[0].status} (terminal states cannot change)`
    );
  }
  return null;
}

module.exports = { updateOrderStatus };
