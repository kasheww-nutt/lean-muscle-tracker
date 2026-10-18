import pg, { type PoolClient, type PoolConfig } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { TrackerDatabase } from './database';

export function postgresConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('DATABASE_URL must be a PostgreSQL URL.');
  for (const key of url.searchParams.keys()) {
    if (!['options', 'application_name'].includes(key)) throw Error('Unsupported database URL option. Use DATABASE_SSL_MODE / DATABASE_SSL_CA_FILE and pool environment settings.');
  }
  const mode = process.env.DATABASE_SSL_MODE || 'verify-full';
  if (!['verify-full', 'disable'].includes(mode)) throw Error('DATABASE_SSL_MODE must be verify-full or disable.');
  if (mode === 'disable' && process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw Error('Production remote database connections require verified TLS.');
  }
  const max = Number(process.env.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(max) || max < 1 || max > 50) throw Error('Invalid DATABASE_POOL_MAX.');
  const ca = process.env.DATABASE_SSL_CA || (process.env.DATABASE_SSL_CA_FILE ? readFileSync(process.env.DATABASE_SSL_CA_FILE, 'utf8') : undefined);
  return {
    connectionString, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, query_timeout: 20000, allowExitOnIdle: true,
    ssl: mode === 'disable' ? false : {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
    },
    types: { getTypeParser(oid: number, format?: 'text' | 'binary') {
      if (oid === 20 && format !== 'binary') return (value: string) => {
        const n = Number(value); if (!Number.isSafeInteger(n)) throw Error('Database integer exceeds safe JSON range.'); return n;
      };
      // SUM(bigint) returns NUMERIC, including aggregate activity counts.
      if (oid === 1700 && format !== 'binary') return (value: string) => {
        const n = Number(value); if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) throw Error('Database number exceeds safe JSON range.'); return n;
      };
      return pg.types.getTypeParser(oid, format as 'text');
    } },
  };
}

// Only internal query templates use this adapter. Never interpolate user values.
export function postgresSql(sql: string) {
  let result = '', index = 0, quote = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      result += c;
      if (c === quote) {
        if (sql[i + 1] === quote) result += sql[++i]; else quote = '';
      }
    } else if (c === "'" || c === '"') { quote = c; result += c; }
    else if (c === '?') result += '$' + ++index;
    else if (/[A-Za-z_]/.test(c)) {
      let end = i + 1; while (end < sql.length && /[A-Za-z_0-9]/.test(sql[end])) end++;
      const word = sql.slice(i, end); result += word.toLowerCase() === 'rowid' ? 'record_order' : word; i = end - 1;
    } else result += c;
  }
  return result;
}

function migrationFiles(directory: string) {
  return readdirSync(directory).filter(f => /^\d+.*\.sql$/.test(f)).sort().map(name => {
    const sql = readFileSync(resolve(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

export async function migratePostgres(pool: pg.Pool, directory = resolve(process.cwd(), 'database/postgres/migrations')) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [673017543]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const migration of migrationFiles(directory)) {
      const { rows } = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [migration.name]);
      if (rows.length) {
        if (rows[0].checksum !== migration.checksum) throw Error('An applied migration was modified: ' + migration.name);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name,checksum) VALUES ($1,$2)', [migration.name, migration.checksum]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function databaseAdapter(query: (sql: string, values: unknown[]) => Promise<pg.QueryResult>): TrackerDatabase {
  return { prepare(sql) {
    const text = postgresSql(sql);
    return { bind(...values) {
      const params = values.map(v => v === undefined ? null : v);
      return {
        async all<T>() { return { results: (await query(text, params)).rows as T[] }; },
        async first<T>() { return ((await query(text, params)).rows[0] as T | undefined) ?? null; },
        async run() { return { meta: { changes: (await query(text, params)).rowCount ?? 0 } }; },
      };
    } };
  } };
}

export function openPostgres(connectionString: string, options: { autoMigrate?: boolean; migrations?: string; expectedMigrations?: readonly {name:string;checksum:string}[] } = {}) {
  const pool = new pg.Pool(postgresConfig(connectionString));
  pool.on('error', () => console.error('Idle PostgreSQL connection failed.'));
  const directory = options.migrations || resolve(process.cwd(), 'database/postgres/migrations');
  const ready = (async () => {
    if (options.autoMigrate) await migratePostgres(pool, directory);
    const { rows } = await pool.query('SELECT name,checksum FROM schema_migrations');
    for (const migration of options.expectedMigrations ?? migrationFiles(directory)) {
      if (!rows.some(row => row.name === migration.name && row.checksum === migration.checksum)) throw Error('Database schema is outdated. Run npm run db:migrate.');
    }
  })();
  // Connection failure is surfaced on readiness/queries without an unhandled rejection.
  ready.catch(() => {});
  const query = async (sql: string, values: unknown[]) => { await ready; return pool.query(sql, values); };
  const db = databaseAdapter(query);
  const transaction = async <T>(work: (tx: TrackerDatabase) => Promise<T>) => {
    await ready; const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(databaseAdapter((sql, values) => client.query(sql, values)));
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
  return { db: { ...db, transaction, close: () => pool.end() }, ready, pool, close: () => pool.end() };
}
