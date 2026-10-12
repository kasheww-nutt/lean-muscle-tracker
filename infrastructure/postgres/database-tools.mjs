import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, mkdtempSync } from 'node:fs';

// libpq does not expand an environment PGDATABASE URI in pg_dump/pg_restore.
// Parse it explicitly and pass credentials only through the child environment.
import { databaseEnvironment } from './connection-env.mjs';
const environment = databaseEnvironment(process.env);
const run = (command, args) => {
  const result = spawnSync(command, args, { env: environment, stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(command + ' failed; no successful backup/restore is claimed.');
};
if (process.argv[2] === 'backup') {
  process.umask(0o077);
  mkdirSync('/backups', { recursive: true, mode: 0o700 });
  const directory = mkdtempSync('/backups/tracker-' + new Date().toISOString().replace(/[:.]/g, '-') + '-');
  const partial = directory + '/database.partial', complete = directory + '/database.dump';
  try {
    run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file=' + partial]);
    renameSync(partial, complete);
    console.log(complete);
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
} else if (process.argv[2] === 'restore') {
  const file = process.argv[3];
  if (process.env.RESTORE_CONFIRM !== 'disposable-database-only') throw Error('Set RESTORE_CONFIRM=disposable-database-only after checking the fresh target.');
  if (process.argv.length !== 4 || !file?.startsWith('/backups/') || file.includes('/../') || !file.endsWith('.dump')) throw Error('Supply one backup file mounted under /backups.');
  run('pg_restore', ['--dbname=' + environment.PGDATABASE, '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', file]);
} else throw Error('Choose backup or restore.');
