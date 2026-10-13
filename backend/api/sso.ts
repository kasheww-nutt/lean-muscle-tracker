import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../services/runtime';
import { createTrackerSessionCookie } from '../services/access';
import { accountsEnabled, accountForSubject } from '../services/accounts';
import { origin, allowAttempt } from '../services/security';

const headers = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const random = () => randomBytes(32).toString('base64url');
const cookieName = 'lean_sso_state';
function configuration() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const owner = process.env.COGNITO_OWNER_SUB;
  const domain = process.env.COGNITO_DOMAIN;
  if (!userPoolId || !clientId || !owner || !domain || !env.TRACKER_SESSION_SECRET || env.TRACKER_SESSION_SECRET.length < 32) throw Error('SSO is not configured.');
  const url = new URL(domain);
  if (url.protocol !== 'https:' || url.href !== url.origin + '/') throw Error('Invalid Cognito domain.');
  return {userPoolId,clientId,owner,domain:url.origin,callback:`${origin()}/sso/callback`};
}
type Identity = {sub:string;nonce?:string;email_verified?:boolean};
export async function verifyIdentity(token:string, nonce:string, verifier: {verify(token:string):Promise<Identity>}) {
  const identity = await verifier.verify(token);
  if (!nonce || identity.nonce !== nonce || !identity.sub || (accountsEnabled() ? identity.email_verified !== true : (!process.env.COGNITO_OWNER_SUB || identity.sub !== process.env.COGNITO_OWNER_SUB))) throw Error('Account is not authorized.');
  return identity;
}
function sign(payload:string) { return createHmac('sha256',env.TRACKER_SESSION_SECRET!).update(payload).digest('base64url'); }
const clear = () => `${cookieName}=; Path=/sso; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
export function safeReturnPath(value: string | null) {
  if (!value || value.length > 4096) return '/';
  const url = new URL(value,origin());
  return url.origin === origin() && url.pathname === '/oauth/authorize' ? url.pathname + url.search : '/';
}
export async function login(request?: Request) {
  try {
    const config = configuration();
    if (!await allowAttempt('sso-start',60,60_000)) return new Response('Try again later.',{status:429,headers});
    const state = random(), nonce = random(), verifier = random();
    const encoded = Buffer.from(JSON.stringify({state,nonce,verifier,next:safeReturnPath(request ? new URL(request.url).searchParams.get('next') : null),expires:Date.now()+300_000})).toString('base64url');
    const url = new URL(`${config.domain}/oauth2/authorize`);
    url.search = new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.callback,scope:accountsEnabled()?'openid email profile':'openid',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    return new Response(null,{status:302,headers:{...headers,Location:url.href,'Set-Cookie':`${cookieName}=${encoded}.${sign(encoded)}; Path=/sso; Max-Age=300; HttpOnly; Secure; SameSite=Lax`}});
  } catch { return new Response('SSO is not configured.',{status:503,headers}); }
}
export async function callback(request:Request) {
  const responseHeaders = new Headers({...headers,'Set-Cookie':clear()});
  try {
    const config = configuration();
    const url = new URL(request.url);
    const value = (request.headers.get('cookie') || '').split(';').map(p=>p.trim()).find(p=>p.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
    const [payload,signature,extra] = value.split('.');
    const actual = Buffer.from(signature || '', 'base64url');
    const expected = Buffer.from(sign(payload || ''),'base64url');
    if (!payload || extra || actual.length !== expected.length || !timingSafeEqual(actual,expected)) throw Error('Invalid state.');
    const state = JSON.parse(Buffer.from(payload,'base64url').toString()) as {state:string;nonce:string;verifier:string;next?:string;expires:number};
    if (state.expires <= Date.now() || state.state !== url.searchParams.get('state') || !url.searchParams.get('code')) throw Error('Invalid callback.');
    const form = new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,redirect_uri:config.callback,code:url.searchParams.get('code')!,code_verifier:state.verifier});
    const tokenHeaders:Record<string,string> = {'Content-Type':'application/x-www-form-urlencoded'};
    if (process.env.COGNITO_CLIENT_SECRET) tokenHeaders.Authorization = 'Basic '+Buffer.from(`${config.clientId}:${process.env.COGNITO_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${config.domain}/oauth2/token`,{method:'POST',headers:tokenHeaders,body:form,signal:AbortSignal.timeout(10_000)});
    if (!response.ok) throw Error('Sign-in rejected.');
    const result = await response.json() as {id_token?:string};
    if (!result.id_token) throw Error('Missing identity.');
    const verifier = CognitoJwtVerifier.create({userPoolId:config.userPoolId,clientId:config.clientId,tokenUse:'id'});
    const identity = await verifyIdentity(result.id_token,state.nonce,verifier);
    const userId = accountsEnabled() ? await accountForSubject(identity.sub) : undefined;
    responseHeaders.append('Set-Cookie',await createTrackerSessionCookie(userId));
    responseHeaders.set('Location',origin()+safeReturnPath(state.next || null));
    return new Response(null,{status:303,headers:responseHeaders});
  } catch { return new Response('Sign-in failed or this account is not authorized. Start again at /sso/login.',{status:401,headers:responseHeaders}); }
}
