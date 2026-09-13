const express = require('express');
const pool = require('./db');
const { publishEvent } = require('./rabbit');
const { recordEvent, getTimeline, getTimelinesForOrders } = require('./orderTimeline');

const router = express.Router();

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
       RETURNING id, user_id, items, total, status, cancellation_reason, created_at, updated_at`,
      [userId, JSON.stringify(items), total]
    );

    const order = result.rows[0];

    await recordEvent(order.id, 'OrderCreated', 'Order Service', true);

    publishEvent('order.created', {
      orderId: order.id,
      userId: order.user_id,
      items: order.items,
      total: order.total,
    });

    await recordEvent(order.id, 'PaymentInitiated', 'RabbitMQ \u2192 Payment Service', true);

    return res.status(201).json({ order });
  } catch (err) {
    console.error('[order-service] Create order error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid order id' });
  }

  const userId = resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Could not determine the requesting user' });
  }

  try {
    const result = await pool.query(
      'SELECT id, user_id, items, total, status, cancellation_reason, created_at, updated_at FROM orders WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = result.rows[0];

    if (order.user_id !== userId) {
      return res.status(404).json({ error: 'Order not found' });
    }

    order.timeline = await getTimeline(order.id);

    return res.status(200).json({ order });
  } catch (err) {
    console.error('[order-service] Get order error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', async (req, res) => {
  const userId = resolveUserId(req);

  if (!userId) {
    return res.status(401).json({ error: 'Could not determine the requesting user' });
  }

  try {
    const result = await pool.query(
      'SELECT id, user_id, items, total, status, cancellation_reason, created_at, updated_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const orders = result.rows;
    const timelines = await getTimelinesForOrders(orders.map((o) => o.id));
    for (const order of orders) {
      order.timeline = timelines[order.id] || [];
    }

    return res.status(200).json({ orders, count: orders.length });
  } catch (err) {
    console.error('[order-service] List orders error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;