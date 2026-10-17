import { createHash } from 'node:crypto';
import { env } from './runtime';

export const accountsEnabled = () => ['cognito','supabase'].includes(process.env.TRACKER_AUTH_MODE || '');
export function ssoConfigured() {
  if (process.env.TRACKER_AUTH_MODE === 'supabase') return !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY && env.TRACKER_SESSION_SECRET && env.TRACKER_SESSION_SECRET.length >= 32);
  return !!(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID && process.env.COGNITO_DOMAIN && process.env.COGNITO_OWNER_SUB && env.TRACKER_SESSION_SECRET && env.TRACKER_SESSION_SECRET.length >= 32);
}

// Called only after the Supabase Auth service has verified the identity.
export async function accountForSupabaseSubject(sub: string) {
  if (!/^[a-f0-9-]{36}$/i.test(sub) || !process.env.SUPABASE_URL) throw Error('Invalid account identity.');
  const subject = new URL(process.env.SUPABASE_URL).origin + ':' + sub;
  const userId = 'account_' + createHash('sha256').update(subject).digest('hex');
  await env.DB.prepare('INSERT INTO tracker_accounts (user_id,cognito_subject) VALUES (?,?) ON CONFLICT(cognito_subject) DO NOTHING').bind(userId,subject).run();
  const row = await env.DB.prepare('SELECT user_id FROM tracker_accounts WHERE cognito_subject=?').bind(subject).first<{user_id:string}>();
  if (row?.user_id !== userId) throw Error('Account identity configuration changed.');
  return userId;
}
// Only a cryptographically verified Cognito subject may enter this function.
// The original owner's records retain their existing user_id; emails never claim records.
export async function accountForSubject(sub: string) {
  if (!sub || sub.length > 128 || !process.env.COGNITO_USER_POOL_ID || !process.env.COGNITO_OWNER_SUB || !env.TRACKER_OWNER_ID) throw Error('Account mapping is not configured.');
  const subject = process.env.COGNITO_USER_POOL_ID + ':' + sub;
  const userId = sub === process.env.COGNITO_OWNER_SUB ? env.TRACKER_OWNER_ID : 'account_' + createHash('sha256').update(subject).digest('hex');
  await env.DB.prepare('INSERT INTO tracker_accounts (user_id,cognito_subject) VALUES (?,?) ON CONFLICT(cognito_subject) DO NOTHING').bind(userId,subject).run();
  const row = await env.DB.prepare('SELECT user_id FROM tracker_accounts WHERE cognito_subject=?').bind(subject).first<{user_id:string}>();
  if (!row || row.user_id !== userId) throw Error('Account identity configuration changed.');
  return row.user_id;
}
