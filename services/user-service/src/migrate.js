const pool = require('./db');

// Simple idempotent migration: creates the users table if it doesn't exist yet.
// Runs automatically on service startup (fine at this scale; a dedicated
// migration tool like node-pg-migrate would be the next step at larger scale).
async function runMigrations() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // Idempotent: safe to run against a DB that already has the users table
  // from before is_admin existed.
  const addIsAdminColumn = `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
  `;

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(createUsersTable);
      await pool.query(addIsAdminColumn);
      console.log('[user-service] Migration check complete: users table ready (with is_admin)');
      return;
    } catch (err) {
      retries -= 1;
      console.log(`[user-service] DB not ready yet, retrying migration... (${retries} left)`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (retries === 0) {
        console.error('[user-service] Failed to run migrations after retries:', err.message);
        throw err;
      }
    }
  }
}

module.exports = { runMigrations };
