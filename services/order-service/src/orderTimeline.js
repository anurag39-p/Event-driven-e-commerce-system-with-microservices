const pool = require('./db');

async function recordEvent(orderId, eventName, service, success = true, detail = null) {
  try {
    await pool.query(
      `INSERT INTO order_events (order_id, event_name, service, success, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, eventName, service, success, detail]
    );
  } catch (err) {
    console.error(`[order-service] Failed to record event "${eventName}" for order ${orderId}:`, err.message);
  }
}

async function getTimeline(orderId) {
  const result = await pool.query(
    `SELECT event_name, service, success, detail, occurred_at
     FROM order_events WHERE order_id = $1 ORDER BY occurred_at ASC`,
    [orderId]
  );
  return result.rows;
}

async function getTimelinesForOrders(orderIds) {
  if (orderIds.length === 0) return {};

  const result = await pool.query(
    `SELECT order_id, event_name, service, success, detail, occurred_at
     FROM order_events WHERE order_id = ANY($1) ORDER BY occurred_at ASC`,
    [orderIds]
  );

  const grouped = {};
  for (const row of result.rows) {
    if (!grouped[row.order_id]) grouped[row.order_id] = [];
    grouped[row.order_id].push(row);
  }
  return grouped;
}

module.exports = { recordEvent, getTimeline, getTimelinesForOrders };