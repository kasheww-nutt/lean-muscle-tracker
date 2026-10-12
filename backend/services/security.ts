import { env } from './runtime';
import { createHash } from 'node:crypto';

export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
// Global owner throttle: deliberately does not trust client-supplied forwarding headers.
export async function allowAttempt(key: string, limit = 10, windowMs = 15 * 60_000) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM auth_attempts WHERE reset_at <= ?').bind(now).run();
  await env.DB.prepare('INSERT INTO auth_attempts (key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').bind(key, now + windowMs).run();
  const row = await env.DB.prepare('SELECT attempts FROM auth_attempts WHERE key=?').bind(key).first<{attempts:number}>();
  return !!row && row.attempts <= limit;
}
export function origin() {
  const value = process.env.PUBLIC_BASE_URL;
  if (!value) throw new Error('PUBLIC_BASE_URL is required.');
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) throw new Error('HTTPS is required.');
  return url.origin;
}
