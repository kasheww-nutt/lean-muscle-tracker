import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const directory = mkdtempSync(join(tmpdir(), 'lean-tracker-smoke-'));
const database = join(directory, 'tracker.sqlite');
const publicOrigin = 'https://tracker.example.test';
const resource = publicOrigin + '/mcp';
const bearer = 'synthetic-mcp-token-at-least-32-characters';
const callback = 'https://client.example.test/callback';
const settings = {
  ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  PUBLIC_BASE_URL: publicOrigin, TRACKER_OWNER_ID: 'synthetic-owner', TRACKER_ACCESS_CODE: '5678',
  TRACKER_SESSION_SECRET: 'synthetic-session-secret-at-least-32-characters', TRACKER_MCP_TOKEN: bearer,
  OAUTH_CLIENT_ID: 'synthetic-client', OAUTH_CLIENT_SECRET: 'synthetic-client-secret-at-least-32-characters', OAUTH_REDIRECT_URIS: callback,
  COGNITO_USER_POOL_ID: '', COGNITO_CLIENT_ID: '', COGNITO_CLIENT_SECRET: '', COGNITO_DOMAIN: '', COGNITO_OWNER_SUB: '',
  DATABASE_DRIVER: 'sqlite', DATABASE_URL: '', DATABASE_PATH: database, MIGRATIONS_PATH: join(process.cwd(), 'database/migrations'),
};
const base = 'http://127.0.0.1:5173';
let running, exit, logs = '', rpcId = 0;
async function start() {
  logs = '';
  running = spawn(process.execPath, ['scripts/start.mjs'], { env: settings, stdio: ['ignore', 'pipe', 'pipe'] });
  exit = new Promise(resolve => running.once('exit', resolve));
  running.stdout.on('data', chunk => logs += chunk);
  running.stderr.on('data', chunk => logs += chunk);
  for (let i = 0; i < 100; i++) {
    if (running.exitCode !== null) throw Error('Production server exited: ' + logs);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Production server did not start: ' + logs);
}
async function stop() {
  if (!running) return;
  running.kill('SIGTERM');
  await exit;
  running = undefined;
}
const rpc = (method, params = {}, token = bearer) => fetch(base + '/mcp', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
});
async function tool(name, args, token = bearer) {
  const response = await rpc('tools/call', { name, arguments: args }, token);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.ok(!result.result.isError, JSON.stringify(result));
  return JSON.parse(result.result.content[0].text);
}
try {
  await start();
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/api/dashboard')).status, 401);
  const unauthenticated = await fetch(base + '/mcp', { method: 'POST', body: '{}' });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get('www-authenticate'), /oauth-protected-resource/);
  assert.equal((await fetch(base + '/mcp')).status, 405);
  const initialized = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(initialized.status, 200, 'MCP initialize');
  assert.equal((await initialized.json()).result.protocolVersion, '2025-06-18');
  const list = await rpc('tools/list');
  assert.equal(list.status, 200, 'MCP tools/list');
  assert.ok((await list.json()).result.tools.length >= 10);

  const discovery = await fetch(base + '/.well-known/oauth-protected-resource');
  assert.equal(discovery.status, 200, 'OAuth resource discovery');
  assert.equal((await discovery.json()).resource, resource);
  const verifier = 'v'.repeat(43);
  const params = new URLSearchParams({ client_id: settings.OAUTH_CLIENT_ID, redirect_uri: callback,
    response_type: 'code', scope: 'tracker', resource, state: 'synthetic-state', code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url') });
  const consent = await fetch(base + '/oauth/authorize?' + params, {
    method: 'POST', redirect: 'manual', headers: { Origin: publicOrigin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: '5678' }),
  });
  assert.equal(consent.status, 303);
  const redirect = new URL(consent.headers.get('location'));
  assert.equal(redirect.origin + redirect.pathname, callback);
  assert.equal(redirect.searchParams.get('state'), 'synthetic-state');
  const grant = new URLSearchParams({ grant_type: 'authorization_code', client_id: settings.OAUTH_CLIENT_ID,
    client_secret: settings.OAUTH_CLIENT_SECRET, resource, redirect_uri: callback,
    code: redirect.searchParams.get('code'), code_verifier: verifier });
  const exchange = () => fetch(base + '/oauth/token', { method: 'POST', body: grant });
  const issued = await exchange();
  assert.equal(issued.status, 200);
  const tokens = await issued.json();
  assert.equal((await exchange()).status, 400);
  assert.equal((await rpc('ping', {}, tokens.access_token)).status, 200);

  const login = await fetch(base + '/api/access', { method: 'POST',
    headers: { Origin: publicOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '5678' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const readDashboard = async () => {
    const response = await fetch(base + '/api/dashboard?date=2026-10-12', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const meal = await tool('tracker_log_meal', { name: 'Synthetic smoke meal', date: '2026-10-12', calories: 120, protein: 5, carbs: 10, fat: 4 }, tokens.access_token);
  assert.equal(meal.saved, true);
  await tool('tracker_update_meal', { id: meal.id, calories: 100 });
  await tool('tracker_log_meal', { name: 'Fictional smoke meal', date: '2026-10-12', calories: 900, protein: 50, carbs: 50, fat: 20, is_test: true });
  const water = await tool('tracker_log_water', { date: '2026-10-12', amount_ml: 250 });
  await tool('tracker_update_water', { id: water.id, amount_ml: 300 });
  await tool('tracker_log_weight', { date: '2026-10-12', weight_kg: 60 });
  await tool('tracker_log_workout', { date: '2026-10-12', session: 'Synthetic upper', exercises: [{ name: 'Press', sets: [{ reps: 10, load_kg: 20 }] }] });
  assert.equal((await readDashboard()).totals.calories, 100);
  const day = await tool('tracker_get_day', { date: '2026-10-12' });
  assert.equal(day.waterTotalMl, 300);
  assert.equal((await fetch(base + '/api/history', { headers: { Cookie: cookie } })).status, 200);

  const backup = spawnSync(process.execPath, ['scripts/backup.mjs'], { env: { ...settings, BACKUP_DIRECTORY: join(directory, 'backups') }, encoding: 'utf8' });
  assert.equal(backup.status, 0, backup.stderr);
  const backupPath = backup.stdout.trim();
  assert.ok(backupPath.startsWith(join(directory, 'backups') + '/'));
  await stop();
  await start();
  assert.equal((await readDashboard()).totals.calories, 100);
  assert.equal((await rpc('ping', {}, tokens.access_token)).status, 200);
  await tool('tracker_remove_meal', { id: meal.id });
  await tool('tracker_remove_water', { id: water.id });
  assert.equal((await readDashboard()).totals.calories, 0);
  await stop();
  copyFileSync(backupPath, database);
  for (const suffix of ['-wal', '-shm']) rmSync(database + suffix, { force: true });
  await start();
  assert.equal((await readDashboard()).totals.calories, 100);
  assert.equal((await tool('tracker_get_day', { date: '2026-10-12' })).waterTotalMl, 300);
  console.log('Production HTTP smoke passed: UI, auth, MCP, OAuth consent/PKCE/replay, meals/water/weight/workouts, restart persistence, online backup and restore.');
} finally {
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
