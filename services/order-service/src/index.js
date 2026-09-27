require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { runMigrations } = require('./migrate');
const { ensureIdempotencyTable, getDlqStatus, replayDlq } = require('./reliability');
const { connectRabbit, startPaymentResultConsumer, getChannel, getTopology, QUEUE } = require('./rabbit');
const { updateOrderStatus } = require('./orderStatus');
const { recordEvent } = require('./orderTimeline');
const orderRoutes = require('./orderRoutes');

const app = express();
app.use(express.json());

const SERVICE_NAME = 'order-service';
const PORT = process.env.PORT || 4003;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

app.get('/health', (req, res) => {
  res.status(200).json({
    service: SERVICE_NAME,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/', orderRoutes);

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.isAdmin !== true) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/admin/dlq', requireAdmin, async (req, res) => {
  try {
    const topology = getTopology();
    if (!topology) {
      return res.status(503).json({ error: 'Queue topology not ready yet' });
    }
    const status = await getDlqStatus(getChannel(), topology.dlqQueue);
    return res.status(200).json(status);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/admin/dlq/replay', requireAdmin, async (req, res) => {
  try {
    const topology = getTopology();
    if (!topology) {
      return res.status(503).json({ error: 'Queue topology not ready yet' });
    }
    const replayed = await replayDlq(getChannel(), topology.dlqQueue, QUEUE);
    return res.status(200).json({ replayed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function handlePaymentResult(routingKey, payload) {
  const { orderId, reason } = payload;

  if (routingKey === 'payment.succeeded') {
    await recordEvent(orderId, 'PaymentSuccessful', 'Payment Service', true);
    await updateOrderStatus(orderId, 'CONFIRMED');
    await recordEvent(orderId, 'OrderConfirmed', 'Order Service', true);
  } else if (routingKey === 'payment.failed') {
    await recordEvent(orderId, 'PaymentFailed', 'Payment Service', false, reason);
    await updateOrderStatus(orderId, 'CANCELLED', reason);
    await recordEvent(orderId, 'OrderCancelled', 'Order Service', true, reason);
  } else if (routingKey === 'stock.reservation.failed') {
    // Product Service couldn't atomically reserve stock for one or more
    // items (out of stock, or the product no longer exists). Cancel the
    // order the same way a payment failure would - Payment Service may
    // still charge the card independently, but there's nothing to ship,
    // so the order can't be allowed to become CONFIRMED.
    await recordEvent(orderId, 'StockReservationFailed', 'Product Service', false, reason);
    await updateOrderStatus(orderId, 'CANCELLED', reason);
    await recordEvent(orderId, 'OrderCancelled', 'Order Service', true, reason);
  } else {
    throw new Error(`Unrecognized routing key: ${routingKey}`);
  }
}

async function start() {
  await runMigrations();
  await ensureIdempotencyTable(pool);
  await connectRabbit();
  await startPaymentResultConsumer(pool, handlePaymentResult);

  app.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(`[${SERVICE_NAME}] Failed to start:`, err.message);
    process.exit(1);
  });
}

module.exports = { app, handlePaymentResult, requireAdmin };