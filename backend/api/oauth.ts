import { randomBytes, createHash } from 'node:crypto';
import { env } from '../services/runtime';
import { allowAttempt, hash, origin } from '../services/security';
import { safeCodeEqual, sameOrigin } from '../services/access';

const headers = { 'Cache-Control': 'no-store', 'Pragma':'no-cache' };
const opaque = () => randomBytes(32).toString('base64url');
const fail = (error: string, status = 400) => Response.json({error}, {status, headers});
function config() {
  const client = process.env.OAUTH_CLIENT_ID;
  const redirects = (process.env.OAUTH_REDIRECT_URIS || '').split(',').filter(Boolean);
  if (!client || !redirects.length) throw new Error('OAuth is not configured.');
  return {client, redirects, base:origin()};
}
export function metadata(resource = false) {
  try {
    const {base} = config();
    return Response.json(resource ? {
      resource:`${base}/mcp`, authorization_servers:[base], scopes_supported:['tracker'], bearer_methods_supported:['header'],
    } : {
      issuer:base, authorization_endpoint:`${base}/oauth/authorize`, token_endpoint:`${base}/oauth/token`, revocation_endpoint:`${base}/oauth/revoke`,
      response_types_supported:['code'], grant_types_supported:['authorization_code','refresh_token'],
      token_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'], code_challenge_methods_supported:['S256'], scopes_supported:['tracker'],
    }, {headers:{...headers,'Access-Control-Allow-Origin':'*'}});
  } catch { return fail('temporarily_unavailable',503); }
}
function validate(params: URLSearchParams) {
  const {base,client,redirects} = config();
  if (params.get('client_id') !== client || !redirects.includes(params.get('redirect_uri') || '')) throw new Error('invalid_client');
  if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') || '')) throw new Error('invalid_request');
  if (params.get('resource') !== `${base}/mcp`) throw new Error('invalid_target');
  if (params.get('scope') && params.get('scope') !== 'tracker') throw new Error('invalid_scope');
  if ((params.get('state') || '').length > 2048) throw new Error('invalid_request');
  return {base,client};
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function authorize(request: Request) {
  try {
    const url = new URL(request.url);
    const {client} = validate(url.searchParams);
    if (request.method === 'GET') {
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Lean Muscle Tracker</title><body><h1>Connect Lean Muscle Tracker</h1><p>This grants client <strong>${escape(client)}</strong> access to read, add, update and remove your fitness records.</p><p>Approve only if you started this connection.</p><form method="post"><label>Tracker access code <input name="code" type="password" autocomplete="current-password" required maxlength="64"></label><button type="submit">Approve connection</button></form></body></html>`, {headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'}});
    }
    if (!sameOrigin(request)) return fail('access_denied',403);
    if (!await allowAttempt('owner-login')) return fail('slow_down',429);
    const form = await request.formData();
    const code = String(form.get('code') || '').trim();
    if (!env.TRACKER_ACCESS_CODE || !safeCodeEqual(code,env.TRACKER_ACCESS_CODE)) return fail('access_denied',401);
    const token = opaque();
    await env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at<=?').bind(Date.now()).run();
    await env.DB.prepare('INSERT INTO oauth_codes (code_hash,client_id,redirect_uri,challenge,resource,expires_at) VALUES (?,?,?,?,?,?)').bind(hash(token),client,url.searchParams.get('redirect_uri'),url.searchParams.get('code_challenge'),url.searchParams.get('resource'),Date.now()+300_000).run();
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('code',token);
    if (url.searchParams.has('state')) redirect.searchParams.set('state',url.searchParams.get('state')!);
    return new Response(null,{status:303,headers:{...headers,Location:redirect.href}});
  } catch { return fail('invalid_request'); }
}
async function issue(client: string, resource: string) {
  const access = opaque(), refresh = opaque();
  await env.DB.prepare('DELETE FROM oauth_tokens WHERE expires_at<=?').bind(Date.now()).run();
  for (const [token,kind,ttl] of [[access,'access',3600_000],[refresh,'refresh',30*86400_000]] as const) {
    await env.DB.prepare('INSERT INTO oauth_tokens (token_hash,client_id,kind,resource,expires_at) VALUES (?,?,?,?,?)').bind(hash(token),client,kind,resource,Date.now()+ttl).run();
  }
  return Response.json({access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:'tracker'}, {headers});
}
export async function token(request: Request, revoke = false) {
  try {
    const {client,base} = config();
    if (!await allowAttempt('oauth-token',120,60_000)) return fail('slow_down',429);
    const body = new URLSearchParams(await request.text());
    let clientId = body.get('client_id'), secret = body.get('client_secret') || '';
    const auth = request.headers.get('authorization');
    if (auth?.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6),'base64').toString();
      const index = decoded.indexOf(':');
      if (index < 0) return fail('invalid_client',401);
      clientId = decodeURIComponent(decoded.slice(0,index)); secret = decodeURIComponent(decoded.slice(index+1));
    }
    if (clientId !== client || (process.env.OAUTH_CLIENT_SECRET && !safeCodeEqual(secret,process.env.OAUTH_CLIENT_SECRET))) return fail('invalid_client',401);
    if (revoke) {
      await env.DB.prepare('DELETE FROM oauth_tokens WHERE token_hash=? AND client_id=?').bind(hash(body.get('token') || ''),client).run();
      return new Response(null,{status:200,headers});
    }
    if (body.get('resource') !== `${base}/mcp`) return fail('invalid_target');
    if (body.get('grant_type') === 'refresh_token') {
      const value = hash(body.get('refresh_token') || '');
      // DELETE RETURNING consumes the token atomically, preventing replay across workers.
      const row = await env.DB.prepare("DELETE FROM oauth_tokens WHERE token_hash=? AND client_id=? AND kind='refresh' AND resource=? AND expires_at>? RETURNING resource").bind(value,client,`${base}/mcp`,Date.now()).first<{resource:string}>();
      if (!row) return fail('invalid_grant');
      return issue(client,row.resource);
    }
    if (body.get('grant_type') !== 'authorization_code') return fail('unsupported_grant_type');
    const verifier = body.get('code_verifier') || '';
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return fail('invalid_grant');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const row = await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash=? AND client_id=? AND redirect_uri=? AND challenge=? AND resource=? AND expires_at>? RETURNING resource').bind(hash(body.get('code') || ''),client,body.get('redirect_uri'),challenge,`${base}/mcp`,Date.now()).first<{resource:string}>();
    if (!row) return fail('invalid_grant');
    return issue(client,row.resource);
  } catch { return fail('invalid_request'); }
}
