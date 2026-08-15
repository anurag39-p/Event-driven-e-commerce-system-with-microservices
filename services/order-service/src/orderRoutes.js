const express = require('express');
const pool = require('./db');
const { publishEvent } = require('./rabbit');

const router = express.Router();

// Resolves which user this request belongs to.
// In normal use, the Gateway already verified the JWT and attached x-user-id.
// The req.body.userId fallback exists only for testing this service directly
// (bypassing the Gateway) during development.
function resolveUserId(req) {
  if (req.headers['x-user-id']) {
    return parseInt(req.headers['x-user-id'], 10);
  }
  if (req.body && req.body.userId) {
    return parseInt(req.body.userId, 10);
  }
  return null;
}

function isValidItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((item) =>
    item &&
    typeof item.productId === 'string' &&
    Number.isInteger(item.quantity) && item.quantity > 0 &&
    typeof item.price === 'number' && item.price >= 0
  );
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// POST /orders - create a new order with status PENDING
router.post('/', async (req, res) => {
  const userId = resolveUserId(req);
  const { items } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Could not determine the requesting user' });
  }
  if (!isValidItems(items)) {
    return res.status(400).json({
      error: 'items must be a non-empty array of { productId: string, quantity: positive integer, price: non-negative number }',
    });
  }

  const total = calculateTotal(items);

  try {
    const result = await pool.query(
      `INSERT INTO orders (user_id, items, total, status)
       VALUES ($1, $2, $3, 'PENDING')
       RETURNING id, user_id, items, total, status, created_at, updated_at`,
      [userId, JSON.stringify(items), total]
    );

    const order = result.rows[0];

    // Publish the event that kicks off the saga. Payment Service is
    // listening for this and will decide whether the order gets confirmed
    // or cancelled - the Order Service doesn't call Payment directly.
    publishEvent('order.created', {
      orderId: order.id,
      userId: order.user_id,
      items: order.items,
      total: order.total,
    });

    return res.status(201).json({ order });
  } catch (err) {
    console.error('[order-service] Create order error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/:id - fetch a single order
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid order id' });
  }

  try {
    const result = await pool.query(
      'SELECT id, user_id, items, total, status, created_at, updated_at FROM orders WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    return res.status(200).json({ order: result.rows[0] });
  } catch (err) {
    console.error('[order-service] Get order error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders?userId=123 - list orders for a user
// (If called through the Gateway, userId is also available via x-user-id;
// the query param lets you explicitly ask "give me this user's orders".)
router.get('/', async (req, res) => {
  const { userId } = req.query;

  if (!userId || !/^\d+$/.test(userId)) {
    return res.status(400).json({ error: 'A numeric userId query parameter is required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, user_id, items, total, status, created_at, updated_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    return res.status(200).json({ orders: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[order-service] List orders error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;