require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { ensureIdempotencyTable, getDlqStatus, replayDlq } = require('./reliability');
const { connectRabbit, onConnected, publishEvent, startOrderCreatedConsumer, getChannel, getTopology, QUEUE } = require('./rabbit');
const { processPayment } = require('./mockPayment');

const app = express();
app.use(express.json());

const SERVICE_NAME = 'payment-service';
const PORT = process.env.PORT || 4004;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

app.get('/health', (req, res) => {
  res.status(200).json({
    service: SERVICE_NAME,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

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

async function handleOrderCreated(routingKey, order) {
  if (routingKey !== 'order.created') {
    throw new Error(`Unrecognized routing key: ${routingKey}`);
  }

  const { orderId } = order;
  const result = processPayment(order);

  if (result.succeeded) {
    publishEvent('payment.succeeded', { orderId, total: order.total });
  } else {
    publishEvent('payment.failed', { orderId, reason: result.reason });
  }
}

async function start() {
  await ensureIdempotencyTable(pool);

  onConnected(() => startOrderCreatedConsumer(pool, handleOrderCreated));
  await connectRabbit();

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

module.exports = { app, handleOrderCreated, requireAdmin };