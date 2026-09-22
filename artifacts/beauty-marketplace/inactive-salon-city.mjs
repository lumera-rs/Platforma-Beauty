// Server-only projection: never import this module into browser code.
// Lazy construction avoids any connection during import or ordinary rendering.
let pool;
export async function resolveInactiveSalonCity(slug) {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('Tests must inject resolveInactiveSalonCity; ambient DB access is forbidden');
  }
  if (!process.env.DATABASE_URL) throw new Error('Inactive salon city lookup requires DATABASE_URL');
  if (!pool) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 3000,
      statement_timeout: 3000, query_timeout: 3500,
      options: '-c default_transaction_read_only=on',
      allowExitOnIdle: true,
    });
    pool.on('error', () => { console.error('Inactive salon city database pool is unavailable'); });
  }
  return readInactiveSalonCity(pool, slug);
}

export async function readInactiveSalonCity(reader, slug) {
  const { rows } = await reader.query({
    text: 'SELECT city FROM salons WHERE slug = $1 AND active = false LIMIT 1',
    values: [slug],
  });
  const city = rows[0]?.city;
  if (typeof city !== 'string' || !city.trim()) throw new Error('Inactive salon city is unavailable');
  return city;
}