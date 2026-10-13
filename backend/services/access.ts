import { env } from "./runtime";
import { accountsEnabled } from "./accounts";

const COOKIE_NAME = "lean_tracker_access";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function hmacKey() {
  const secret = env.TRACKER_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Tracker access is not configured.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function cookieValue(request: Request) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return "";
}

export async function trackerUser(request: Request): Promise<string | null> {
  const value = cookieValue(request);
  try {
    const parts = value.split('.');
    if (parts.length === 3 && parts[0] === 'v2') {
      const [, payload, signatureHex] = parts;
      if (payload.length > 2048 || !/^[a-f0-9]{64}$/.test(signatureHex)) return null;
      const signature = Uint8Array.from(signatureHex.match(/.{2}/g)!, p => parseInt(p,16));
      if (!await crypto.subtle.verify('HMAC',await hmacKey(),signature,encoder.encode('v2.'+payload))) return null;
      const claims = JSON.parse(Buffer.from(payload,'base64url').toString()) as {userId?:unknown;expiry?:unknown};
      if (typeof claims.userId !== 'string' || typeof claims.expiry !== 'number' || claims.expiry <= Date.now()) return null;
      const row = await env.DB.prepare('SELECT user_id FROM tracker_accounts WHERE user_id=?').bind(claims.userId).first();
      return row ? claims.userId : null;
    }
    // Existing owner cookies work during rollout, but never unlock account mode.
    if (accountsEnabled()) return null;
    const [expiry, signatureHex, extra] = parts;
    if (!expiry || !signatureHex || extra || !/^\d{13}$/.test(expiry) || !/^[a-f0-9]{64}$/.test(signatureHex) || Number(expiry) <= Date.now()) return null;
    const signature = Uint8Array.from(signatureHex.match(/.{2}/g)!, p=>parseInt(p,16));
    return await crypto.subtle.verify('HMAC',await hmacKey(),signature,encoder.encode(expiry)) ? env.TRACKER_OWNER_ID || null : null;
  } catch { return null; }
}
export async function hasTrackerAccess(request: Request) { return !!await trackerUser(request); }

export async function createTrackerSessionCookie(userId?: string) {
  const expiry = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = userId ? 'v2.' + Buffer.from(JSON.stringify({userId,expiry})).toString('base64url') : String(expiry);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC',await hmacKey(),encoder.encode(payload)));
  const signatureHex = Array.from(signature,b=>b.toString(16).padStart(2,'0')).join('');
  return `${COOKIE_NAME}=${payload}.${signatureHex}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=${userId ? 'Lax' : 'Strict'}`;
}

export function clearedTrackerSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function safeCodeEqual(candidate: string, expected: string) {
  if (candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  const configured = process.env.PUBLIC_BASE_URL;
  return !!origin && origin === (configured ? new URL(configured).origin : new URL(request.url).origin);
}
