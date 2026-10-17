import { openDatabase, type TrackerDatabase } from './database';
import { resolve } from 'node:path';
import { openPostgres } from './postgres';
import { AsyncLocalStorage } from 'node:async_hooks';

// Workers must never share an open TCP connection between request contexts.
const requestDatabase = new AsyncLocalStorage<() => TrackerDatabase>();
export function withRequestDatabase<T>(getDatabase: () => TrackerDatabase, work: () => T): T {
  return requestDatabase.run(getDatabase, work);
}

const state = globalThis as typeof globalThis & { trackerDB?: TrackerDatabase };
export const env = {
  get DB() {
    const scoped = requestDatabase.getStore();
    if (scoped) return scoped();
    if (!state.trackerDB) {
      if (process.env.DATABASE_DRIVER === 'sqlite') {
        state.trackerDB = openDatabase(process.env.DATABASE_PATH || resolve(process.cwd(), 'data/tracker.sqlite'), process.env.MIGRATIONS_PATH || resolve(process.cwd(), 'database/migrations')).db;
      } else {
        if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required for shared PostgreSQL storage.');
        state.trackerDB = openPostgres(process.env.DATABASE_URL, { autoMigrate: process.env.DATABASE_AUTO_MIGRATE === '1' }).db;
      }
    }
    return state.trackerDB;
  },
  get TRACKER_OWNER_ID() { return process.env.TRACKER_OWNER_ID; },
  get TRACKER_ACCESS_CODE() { return process.env.TRACKER_ACCESS_CODE; },
  get TRACKER_SESSION_SECRET() { return process.env.TRACKER_SESSION_SECRET; },
  get TRACKER_MCP_TOKEN() { return process.env.TRACKER_MCP_TOKEN; },
};
