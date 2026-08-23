const pool = require('./db');

async function updateOrderStatus(orderId, newStatus, reason = null) {
  const result = await pool.query(
    `UPDATE orders SET status = $1, cancellation_reason = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id, status, cancellation_reason`,
    [newStatus, reason, orderId]
  );

  if (result.rows.length === 0) {
    console.error(`[order-service] Tried to update status for unknown order id ${orderId}`);
    return null;
  }

  console.log(`[order-service] Order ${orderId} status updated to ${newStatus}`);
  return result.rows[0];
}

module.exports = { updateOrderStatus };