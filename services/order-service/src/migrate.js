const pool = require('./db');

// Simple idempotent migration: creates the orders table if it doesn't exist yet.
async function runMigrations() {
  const createOrdersTable = `
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      items JSONB NOT NULL,
      total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(createOrdersTable);
      console.log('[order-service] Migration check complete: orders table ready');
      return;
    } catch (err) {
      retries -= 1;
      console.log(`[order-service] DB not ready yet, retrying migration... (${retries} left)`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (retries === 0) {
        console.error('[order-service] Failed to run migrations after retries:', err.message);
        throw err;
      }
    }
  }
}

module.exports = { runMigrations };