const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'admin',
  password: process.env.POSTGRES_PASSWORD || 'admin123',
  database: process.env.POSTGRES_DB || 'ecommerce',
});

pool.on('error', (err) => {
  console.error('[user-service] Unexpected PostgreSQL error on idle client', err);
});

module.exports = pool;
