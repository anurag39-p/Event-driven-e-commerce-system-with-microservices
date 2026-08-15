require('dotenv').config();
const express = require('express');
const { runMigrations } = require('./migrate');
const { router: authRouter } = require('./authRoutes');

const app = express();
app.use(express.json());

const SERVICE_NAME = 'user-service';
const PORT = process.env.PORT || 4001;

app.get('/health', (req, res) => {
  res.status(200).json({
    service: SERVICE_NAME,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/', authRouter);

async function start() {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error(`[${SERVICE_NAME}] Failed to start:`, err.message);
  process.exit(1);
});
