import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../services/runtime';
import { origin, allowAttempt, hash } from '../services/security';
import { sameOrigin, createTrackerSessionCookie } from '../services/access';
import { accountForSupabaseSubject } from '../services/accounts';

const cookieName = 'lean_auth_flow';
const cookieOptions = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const headers = {'Cache-Control':'no-store','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
type Flow = {csrf:string;next:string;expires:number;email?:string};
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const sign = (s:string) => createHmac('sha256',env.TRACKER_SESSION_SECRET!).update('supabase-auth:'+s).digest('hex');
export function safeAuthReturn(value:string|null) {
  if (!value || value.length>4096) return '/';
  const url=new URL(value,origin());
  return url.origin===origin() && url.pathname==='/oauth/authorize' ? url.pathname+url.search : '/';
}
function flowCookie(flow:Flow) {
  const payload=Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${cookieName}=${payload}.${sign(payload)}; Max-Age=600; ${cookieOptions}`;
}
function readFlow(request:Request):Flow {
  const value=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  const [payload,signature,extra]=value.split('.');
  if(!payload||payload.length>8192||extra||!/^[a-f0-9]{64}$/.test(signature||'')||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(payload),'hex')))throw Error('Start sign-in again.');
  const flow=JSON.parse(Buffer.from(payload,'base64url').toString()) as Flow;
  if(typeof flow.csrf!=='string'||typeof flow.expires!=='number'||flow.expires<=Date.now()||flow.expires>Date.now()+601000)throw Error('Start sign-in again.');
  flow.next=safeAuthReturn(flow.next);
  return flow;
}
function page(flow:Flow,message='',status=200) {
  const verify=!!flow.email;
  const form=verify?`<p>A verification code was requested for <strong>${escape(flow.email!)}</strong>. Enter it below.</p><label>Verification code<input name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required autofocus></label><button>Verify and sign in</button><a href="/sso/login?next=${encodeURIComponent(flow.next)}">Use another email or request a new code</a>`:`<p>Enter your email to sign in or create an account. We will send a one-time code.</p><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required autofocus></label><button>Send verification code</button>`;
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Lean Muscle Tracker</title><style>body{margin:0;background:#f8f8fc;color:#211a2d;font:16px system-ui;display:grid;place-items:center;min-height:100svh}main{box-sizing:border-box;margin:20px;padding:28px;width:min(440px,calc(100% - 40px));background:white;border:1px solid #e4dfed;border-radius:24px}h1{font-size:28px}p{line-height:1.6;color:#655c72}label{display:grid;gap:8px;margin:22px 0}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;border-radius:12px;border:1px solid #d9d1e5}button{background:#d8c9ed;cursor:pointer;color:#211a2d;font-weight:650}a{display:block;margin-top:20px;color:#66517d;font-size:14px}.error{color:#9a263e}small{color:#655c72}</style><main><small>LEAN MUSCLE TRACKER</small><h1>${verify?'Check your email':'Your progress, your space.'}</h1>${message?`<p role="alert" class="error">${escape(message)}</p>`:''}<form method="post" action="${verify?'/auth/callback':'/sso/login'}"><input type="hidden" name="csrf" value="${escape(flow.csrf)}">${form}</form><a href="/">Back to tracker</a></main></html>`,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Set-Cookie':flowCookie(flow)}});
}
async function authRequest(path:string,body:unknown) {
  const base=new URL(process.env.SUPABASE_URL!);
  if(base.protocol!=='https:'||!process.env.SUPABASE_PUBLISHABLE_KEY)throw Error('Email sign-in is not configured.');
  return fetch(new URL('/auth/v1/'+path,base),{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
}
export async function login(request:Request) {
  if(process.env.TRACKER_AUTH_MODE!=='supabase')return new Response('Not found',{status:404});
  if(request.method==='GET') {
    if(!env.TRACKER_SESSION_SECRET||env.TRACKER_SESSION_SECRET.length<32)return new Response('Sign-in is not configured.',{status:503,headers});
    return page({csrf:randomBytes(32).toString('base64url'),next:safeAuthReturn(new URL(request.url).searchParams.get('next')),expires:Date.now()+600000});
  }
  let flow:Flow|undefined;
  try {
    if(!sameOrigin(request))return new Response('Request rejected.',{status:403,headers});
    flow=readFlow(request);
    const text=await request.text();if(text.length>4096)throw Error('Invalid sign-in request.');
    const form=new URLSearchParams(text);
    if(form.get('csrf')!==flow.csrf)throw Error('Start sign-in again.');
    const email=(form.get('email')||'').trim().toLowerCase();
    if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');
    if(!await allowAttempt('otp-send:'+hash(email),5,15*60000)||!await allowAttempt('otp-send-global',30,3600000))return page(flow,'Too many code requests. Try again later.',429);
    const response=await authRequest('otp',{email,create_user:true});
    if(!response.ok)throw Error('Could not send a code. Wait a minute and try again.');
    return page({...flow,email,csrf:randomBytes(32).toString('base64url'),expires:Date.now()+600000});
  }catch(error){return flow?page(flow,error instanceof Error?error.message:'Sign-in unavailable.',400):new Response('Start again at /sso/login.',{status:400,headers});}
}
export async function callback(request:Request) {
  if(process.env.TRACKER_AUTH_MODE!=='supabase')return new Response('Not found',{status:404});
  if(request.method!=='POST')return new Response('Enter the code from your email at /sso/login.',{status:400,headers});
  let flow:Flow|undefined;
  try {
    if(!sameOrigin(request))return new Response('Request rejected.',{status:403,headers});
    flow=readFlow(request);if(!flow.email)throw Error('Start sign-in again.');
    const text=await request.text();if(text.length>4096)throw Error('Invalid code request.');
    const form=new URLSearchParams(text),token=form.get('token')||'';
    if(form.get('csrf')!==flow.csrf||!/^\d{6,10}$/.test(token))throw Error('Enter the verification code from your email.');
    if(!await allowAttempt('otp-verify:'+hash(flow.email),10,15*60000))return page(flow,'Too many attempts. Try again later.',429);
    const response=await authRequest('verify',{email:flow.email,token,type:'email'});
    if(!response.ok)throw Error('The code is invalid or expired. Request a new code.');
    const result=await response.json() as {access_token?:string};
    if(!result.access_token)throw Error('Sign-in could not be verified.');
    // Validate using Auth's user endpoint; never trust a browser-supplied subject.
    const verified=await fetch(new URL('/auth/v1/user',process.env.SUPABASE_URL!),{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY!,Authorization:'Bearer '+result.access_token},signal:AbortSignal.timeout(10000)});
    if(!verified.ok)throw Error('Sign-in could not be verified.');
    const user=await verified.json() as {id?:string;email?:string;email_confirmed_at?:string};
    if(!user.id||!user.email_confirmed_at||user.email?.toLowerCase()!==flow.email)throw Error('Email verification is required.');
    const userId=await accountForSupabaseSubject(user.id);
    const out=new Headers(headers);out.set('Location',origin()+flow.next);
    out.append('Set-Cookie',await createTrackerSessionCookie(userId));out.append('Set-Cookie',`${cookieName}=; Max-Age=0; ${cookieOptions}`);
    return new Response(null,{status:303,headers:out});
  }catch(error){return flow?page(flow,error instanceof Error?error.message:'Sign-in unavailable.',400):new Response('Start again at /sso/login.',{status:400,headers});}
}
