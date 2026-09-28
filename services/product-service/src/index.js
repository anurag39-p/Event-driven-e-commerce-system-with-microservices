require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { connectMongo } = require('./db');
const pgPool = require('./pgPool');
const { ensureIdempotencyTable, getDlqStatus, replayDlq } = require('./reliability');
const { connectRabbit, onConnected, startSagaConsumer, getChannel, getTopology, QUEUE } = require('./rabbit');
const { reserveStock, releaseStock } = require('./sagaHandlers');
const productRoutes = require('./productRoutes');

const app = express();
app.use(express.json());

const SERVICE_NAME = 'product-service';
const PORT = process.env.PORT || 4002;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// Was previously missing entirely on this service - /admin/dlq and the
// product-mutation routes below were reachable with no auth at all when
// this service's own port was hit directly (bypassing the Gateway).
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

app.get('/health', (req, res) => {
  res.status(200).json({
    service: SERVICE_NAME,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/', productRoutes(requireAdmin));

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

  onConnected(() => startSagaConsumer(pgPool, handleSagaEvent));
  await connectRabbit();

  app.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error(`[${SERVICE_NAME}] Failed to start:`, err.message);
  process.exit(1);
});
