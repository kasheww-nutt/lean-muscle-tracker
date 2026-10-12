import { env } from "../services/runtime";
import { clearedTrackerSessionCookie, createTrackerSessionCookie, hasTrackerAccess, safeCodeEqual, sameOrigin } from "../services/access";

import { allowAttempt } from '../services/security';

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!env.TRACKER_ACCESS_CODE || !env.TRACKER_SESSION_SECRET) {
    return Response.json({ error: "Tracker access is not configured." }, { status: 503, headers: noStore });
  }
  return Response.json({ authorized: await hasTrackerAccess(request) }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers: noStore });
  const expected = env.TRACKER_ACCESS_CODE;
  if (!expected || !env.TRACKER_SESSION_SECRET) {
    return Response.json({ error: "Tracker access is not configured." }, { status: 503, headers: noStore });
  }

  if (!await allowAttempt('owner-login')) return Response.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: { ...noStore, 'Retry-After': '900' } });
  let body: { code?: unknown };
  try { body = await request.json() as { code?: unknown }; }
  catch { return Response.json({ error: "Enter the access code." }, { status: 400, headers: noStore }); }
  const submitted = typeof body?.code === "string" ? body.code.trim() : "";
  const validFormat = /^[0-9]{4}$/.test(expected)
    ? /^[0-9]{4}$/.test(submitted)
    : /^[a-f0-9-]{32,36}$/i.test(submitted) && /^[a-f0-9]{32}$/.test(submitted.toLowerCase().replaceAll("-", ""));
  const normalized = /^[0-9]{4}$/.test(expected)
    ? submitted
    : submitted.toLowerCase().replaceAll("-", "");
  if (!validFormat || !safeCodeEqual(normalized, expected)) {
    return Response.json({ error: "That access code is incorrect." }, { status: 401, headers: noStore });
  }

  return Response.json({ authorized: true }, {
    headers: { ...noStore, "Set-Cookie": await createTrackerSessionCookie() },
  });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers: noStore });
  return Response.json({ locked: true }, { headers: { ...noStore, "Set-Cookie": clearedTrackerSessionCookie() } });
}
