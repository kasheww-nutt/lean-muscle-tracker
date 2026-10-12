import { env } from './runtime';
import { createHash } from 'node:crypto';

export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
// Global owner throttle: deliberately does not trust client-supplied forwarding headers.
export async function allowAttempt(key: string, limit = 10, windowMs = 15 * 60_000) {
  const now = Date.now();
  const row = await env.DB.prepare(`INSERT INTO auth_attempts (key,attempts,reset_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN auth_attempts.reset_at<=? THEN 1 ELSE auth_attempts.attempts+1 END,
      reset_at=CASE WHEN auth_attempts.reset_at<=? THEN excluded.reset_at ELSE auth_attempts.reset_at END
    RETURNING attempts`).bind(key, now + windowMs, now, now).first<{attempts:number}>();
  return !!row && row.attempts <= limit;
}
export function origin() {
  const value = process.env.PUBLIC_BASE_URL;
  if (!value) throw new Error('PUBLIC_BASE_URL is required.');
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) throw new Error('HTTPS is required.');
  return url.origin;
}
