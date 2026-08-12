const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';
let useSsl = String(process.env.PGSSL || 'false').toLowerCase();
if (useSsl === 'false') {
  useSsl = false;
} else if (useSsl === 'true') {
  useSsl = true;
} else {
  useSsl = !!connectionString && !connectionString.includes('sslmode=disable');
}

// Verify the DB server certificate by default; set PGSSL_REJECT_UNAUTHORIZED=false
// only for managed Postgres presenting a self-signed cert without a CA bundle.
const rejectUnauthorized = String(process.env.PGSSL_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !== 'false';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized } : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 100) console.log('slow query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('Database query error:', { text, error: err.message });
    throw err;
  }
}

async function closePool() {
  await pool.end();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => { await closePool(); process.exit(0); });
}

module.exports = { pool, query, closePool };