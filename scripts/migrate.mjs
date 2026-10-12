import pg from 'pg';
import { postgresConfig, migratePostgres } from '../backend/services/postgres.ts';
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url || url.includes('replace-')) throw Error('Configure DATABASE_URL for migrations.');
if (process.env.DATABASE_MIGRATION_URL) {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required to verify the migration target.');
  const application = new URL(process.env.DATABASE_URL), migration = new URL(url);
  const target = value => [value.hostname, value.port || '5432', value.pathname, value.search].join('|');
  if (target(application) !== target(migration)) throw Error('DATABASE_MIGRATION_URL must target the same database and schema as DATABASE_URL. Only credentials may differ.');
}
const pool = new pg.Pool(postgresConfig(url));
try { await migratePostgres(pool); console.log('PostgreSQL migrations applied under an exclusive advisory lock.'); }
finally { await pool.end(); }
