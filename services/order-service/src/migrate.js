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

  // Transactional outbox: an event row is written in the SAME transaction
  // as the business change it describes (e.g. the order INSERT), so the
  // two either both commit or both roll back. A separate relay (see
  // outbox.js) polls unpublished rows and actually sends them to
  // RabbitMQ - decoupling "did we decide to emit this event" (atomic,
  // guaranteed) from "did the broker actually receive it" (best-effort,
  // retried until it succeeds).
  const createOutboxTable = `
    CREATE TABLE IF NOT EXISTS outbox_events (
      id BIGSERIAL PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );
  `;

  const createOutboxUnpublishedIndex = `
    CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events (id) WHERE published_at IS NULL;
  `;

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(createOrdersTable);
      await pool.query(addCancellationReasonColumn);
      await pool.query(createOrderEventsTable);
      await pool.query(createOrderEventsIndex);
      await pool.query(createOutboxTable);
      await pool.query(createOutboxUnpublishedIndex);
      console.log('[order-service] Migration check complete: orders + outbox_events tables ready');
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