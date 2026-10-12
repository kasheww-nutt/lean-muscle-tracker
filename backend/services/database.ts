import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface TrackerDatabase {
  close?(): Promise<void>;
  transaction?<T>(work: (tx: TrackerDatabase) => Promise<T>): Promise<T>;
  prepare(sql: string): {
    bind(...values: (SQLInputValue | undefined)[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

export function openDatabase(filename: string, migrations = resolve(process.cwd(), 'database/migrations')) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  for (const name of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (!sqlite.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name)) {
        sqlite.exec(readFileSync(resolve(migrations, name), 'utf8'));
        sqlite.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      }
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); sqlite.close(); throw error; }
  }
  const db: TrackerDatabase = {
    async close() { sqlite.close(); },
    prepare(sql) {
      return { bind(...values) {
        const params = values.map(v => v === undefined ? null : v);
        return {
          async all<T>() { return { results: sqlite.prepare(sql).all(...params) as T[] }; },
          async first<T>() { return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null; },
          async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }; },
        };
      } };
    },
  };
  return { db, sqlite };
}
