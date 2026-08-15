const pool = require('./db');

// Updates an order's status. Used by the payment-result event consumer -
// this is what actually completes the saga on the Order Service side.
async function updateOrderStatus(orderId, newStatus) {
  const result = await pool.query(
    `UPDATE orders SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, status`,
    [newStatus, orderId]
  );

  if (result.rows.length === 0) {
    console.error(`[order-service] Tried to update status for unknown order id ${orderId}`);
    return null;
  }

  console.log(`[order-service] Order ${orderId} status updated to ${newStatus}`);
  return result.rows[0];
}

module.exports = { updateOrderStatus };