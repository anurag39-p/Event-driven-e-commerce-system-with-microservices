require('dotenv').config();
const express = require('express');
const pool = require('./db');
const { runMigrations } = require('./migrate');
const { ensureIdempotencyTable, getDlqStatus, replayDlq } = require('./reliability');
const { connectRabbit, startPaymentResultConsumer, getChannel, getTopology, QUEUE } = require('./rabbit');
const { updateOrderStatus } = require('./orderStatus');
const orderRoutes = require('./orderRoutes');

const app = express();
app.use(express.json());

const SERVICE_NAME = 'order-service';
const PORT = process.env.PORT || 4003;

app.get('/health', (req, res) => {
  res.status(200).json({
    service: SERVICE_NAME,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/', orderRoutes);

app.get('/admin/dlq', async (req, res) => {
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

app.post('/admin/dlq/replay', async (req, res) => {
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
  const { orderId } = payload;
  if (routingKey === 'payment.succeeded') {
    await updateOrderStatus(orderId, 'CONFIRMED');
  } else if (routingKey === 'payment.failed') {
    await updateOrderStatus(orderId, 'CANCELLED');
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

start().catch((err) => {
  console.error(`[${SERVICE_NAME}] Failed to start:`, err.message);
  process.exit(1);
});
