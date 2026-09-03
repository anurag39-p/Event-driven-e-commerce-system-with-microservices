const pool = require('./db');

async function runMigrations() {
  const createOrdersTable = `
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      items JSONB NOT NULL,
      total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
      cancellation_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  const addCancellationReasonColumn = `
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
  `;

  const createOrderEventsTable = `
    CREATE TABLE IF NOT EXISTS order_events (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      event_name VARCHAR(50) NOT NULL,
      service VARCHAR(100),
      success BOOLEAN NOT NULL DEFAULT true,
      detail TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  const createOrderEventsIndex = `
    CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);
  `;

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(createOrdersTable);
      await pool.query(addCancellationReasonColumn);
      await pool.query(createOrderEventsTable);
      await pool.query(createOrderEventsIndex);
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