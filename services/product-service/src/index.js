require('dotenv').config();
const express = require('express');
const { connectMongo } = require('./db');
const pgPool = require('./pgPool');
const { ensureIdempotencyTable, getDlqStatus, replayDlq } = require('./reliability');
const { connectRabbit, startSagaConsumer, getChannel, getTopology, QUEUE } = require('./rabbit');
const { reserveStock, releaseStock } = require('./sagaHandlers');
const productRoutes = require('./productRoutes');

const app = express();
app.use(express.json());

const SERVICE_NAME = 'product-service';
const PORT = process.env.PORT || 4002;

app.get('/health', (req, res) => {
  res.status(200).json({
    service: SERVICE_NAME,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/', productRoutes);

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

async function handleSagaEvent(routingKey, payload) {
  if (routingKey === 'order.created') {
    await reserveStock(payload);
  } else if (routingKey === 'payment.failed') {
    await releaseStock(payload);
  } else {
    throw new Error(`Unrecognized routing key: ${routingKey}`);
  }
}

async function start() {
  await connectMongo();
  await ensureIdempotencyTable(pgPool);
  await connectRabbit();
  await startSagaConsumer(pgPool, handleSagaEvent);

  app.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error(`[${SERVICE_NAME}] Failed to start:`, err.message);
  process.exit(1);
});
