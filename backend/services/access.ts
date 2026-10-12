import { env } from "./runtime";

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

export async function hasTrackerAccess(request: Request) {
  const [expiry, signatureHex, extra] = cookieValue(request).split(".");
  if (!expiry || !signatureHex || extra || !/^\d{13}$/.test(expiry) || !/^[a-f0-9]{64}$/.test(signatureHex)) return false;
  if (Number(expiry) <= Date.now()) return false;
  const signature = Uint8Array.from(signatureHex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(), signature, encoder.encode(expiry));
  } catch {
    return false;
  }
}

export async function createTrackerSessionCookie() {
  const expiry = String(Date.now() + SESSION_TTL_SECONDS * 1000);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(expiry)));
  const signatureHex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${COOKIE_NAME}=${expiry}.${signatureHex}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
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
