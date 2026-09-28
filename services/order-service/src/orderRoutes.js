const express = require('express');
const pool = require('./db');
const { recordEvent, getTimeline, getTimelinesForOrders } = require('./orderTimeline');
const { writeOutboxEvent } = require('./outbox');

const router = express.Router();

// Product Service's own port, reached over the internal Docker network -
// not through the Gateway. GET /:id is a public, unauthenticated route
// there (same as the Gateway's rule for GET /products), so no token is
// needed for this server-to-server call.
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:4002';

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
    Number.isInteger(item.quantity) && item.quantity > 0
  );
  // Deliberately not validating (or trusting) a client-supplied `price`
  // here - see priceOrderItems below.
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// Looks up each item's real, current price directly from Product Service
// and returns a new item list built from that - never from whatever
// price the client put in the request body. Without this, anyone who can
// intercept or hand-craft the request could submit `price: 0.01` for a
// real product and be charged (and have Payment Service "charge") almost
// nothing for it.
//
// Returns { items } on success, or { error } for a client-fixable problem
// (bad productId). Throws only for unexpected failures (Product Service
// unreachable, unexpected response shape) so the route can 502 instead of
// silently mispricing an order.
async function priceOrderItems(items) {
  const priced = [];

  for (const item of items) {
    let response;
    try {
      response = await fetch(`${PRODUCT_SERVICE_URL}/${item.productId}`);
    } catch (err) {
      throw new Error(`Could not reach Product Service to price product ${item.productId}: ${err.message}`);
    }

    if (response.status === 404) {
      return { error: `Product ${item.productId} does not exist` };
    }
    if (!response.ok) {
      throw new Error(`Product Service returned ${response.status} while pricing product ${item.productId}`);
    }

    const body = await response.json();
    const product = body.product;
    if (!product || typeof product.price !== 'number') {
      throw new Error(`Product Service returned an unexpected response for product ${item.productId}`);
    }

    priced.push({
      productId: item.productId,
      quantity: item.quantity,
      price: product.price, // authoritative - not the client's value
      name: product.name,
    });
  }

  return { items: priced };
}

router.post('/', async (req, res) => {
  const userId = resolveUserId(req);
  const { items } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Could not determine the requesting user' });
  }
  if (!isValidItems(items)) {
    return res.status(400).json({
      error: 'items must be a non-empty array of { productId: string, quantity: positive integer }',
    });
  }

  let pricedItems;
  try {
    const result = await priceOrderItems(items);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    pricedItems = result.items;
  } catch (err) {
    console.error('[order-service] Failed to price order items:', err.message);
    return res.status(502).json({ error: 'Could not verify current product prices, please try again' });
  }

  const total = calculateTotal(pricedItems);

  const client = await pool.connect();
  let order;
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO orders (user_id, items, total, status)
       VALUES ($1, $2, $3, 'PENDING')
       RETURNING id, user_id, items, total, status, cancellation_reason, created_at, updated_at`,
      [userId, JSON.stringify(pricedItems), total]
    );
    order = result.rows[0];

    // Same transaction as the INSERT above: either both commit (the order
    // exists AND an event is guaranteed to eventually reach Payment/Product
    // Service) or both roll back (nothing happened). No window where the
    // order exists but the rest of the system never finds out about it.
    await writeOutboxEvent(client, {
      eventType: 'order.created',
      payload: {
        orderId: order.id,
        userId: order.user_id,
        items: order.items,
        total: order.total,
      },
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[order-service] Create order error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }

  try {
    await recordEvent(order.id, 'OrderCreated', 'Order Service', true);
    await recordEvent(order.id, 'PaymentInitiated', 'Outbox \u2192 RabbitMQ \u2192 Payment Service', true);
  } catch (err) {
    // The order itself is safely committed at this point; a failure here
    // only means the human-facing timeline is momentarily incomplete, not
    // that the order or its event were lost.
    console.error('[order-service] Failed to record order-creation timeline events:', err.message);
  }

  return res.status(201).json({ order });
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