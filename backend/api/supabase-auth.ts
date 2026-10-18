import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../services/runtime';
import { origin, allowAttempt, hash } from '../services/security';
import { sameOrigin, createTrackerSessionCookie } from '../services/access';
import { accountForSupabaseSubject } from '../services/accounts';

const cookieName = 'lean_auth_flow';
const cookieOptions = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const headers = {'Cache-Control':'no-store','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
type Flow = {csrf:string;next:string;expires:number;email?:string;theme?:'light'|'dark'};
class AuthServiceError extends Error {readonly status:number;constructor(message:string,status=503){super(message);this.status=status;}}
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
  flow.theme=flow.theme==='dark'?'dark':'light';
  return flow;
}
function page(flow:Flow,message='',status=200) {
  const verify=!!flow.email;
  const form=verify?`<p>A verification code was requested for <strong>${escape(flow.email!)}</strong>. Enter it below.</p><label>Verification code<input name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required autofocus></label><button>Verify and sign in</button><a href="/sso/login?next=${encodeURIComponent(flow.next)}&amp;theme=${flow.theme==='dark'?'dark':'light'}">Use another email or request a new code</a>`:`<p>Enter your email to sign in or create an account. We will send a one-time code.</p><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required autofocus></label><button>Send verification code</button>`;
  const theme=flow.theme==='dark'?'dark':'light';
  return new Response(`<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${theme}"><title>Sign in · Lean Muscle Tracker</title><style>
@font-face{font-family:Outfit;src:url('/fonts/outfit-regular.ttf') format('truetype');font-weight:400;font-display:swap}
@font-face{font-family:Outfit;src:url('/fonts/outfit-bold.ttf') format('truetype');font-weight:600 900;font-display:swap}
:root{color-scheme:light;--bg:#f8f8fc;--panel:#fff;--tile:#faf9fe;--soft:#eeebfa;--ink:#191226;--muted:#726d89;--line:#e3def2;--accent:#a98adc;--link:#7653ad;--danger:#9a263e}
:root[data-theme=dark]{color-scheme:dark;--bg:#181521;--panel:#211d2d;--tile:#282235;--soft:#30273f;--ink:#f4effc;--muted:#b3a8c7;--line:#3e3450;--accent:#b599ed;--link:#c8a5fa;--danger:#f0a9ba}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Outfit,ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;min-height:100svh;padding:24px 16px}main{width:100%;max-width:440px;min-width:0}header{display:flex;align-items:center;gap:12px;margin:0 6px 28px;font-size:21px;font-weight:700;letter-spacing:-.5px}header img{display:block;width:46px;height:36px}.card{padding:30px 28px;background:var(--panel);border:1px solid var(--line);border-radius:24px}h1{margin:10px 0 14px;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-1px}p{line-height:1.7;color:var(--muted);overflow-wrap:anywhere}label{display:grid;gap:8px;margin:24px 0 20px;font-weight:600}input,button{box-sizing:border-box;width:100%;font:inherit;min-height:52px;padding:13px 16px;border-radius:14px;border:1px solid var(--line)}input[type=hidden]{display:none!important}input{min-width:0;color:var(--ink);background:var(--tile)}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}input[name=token]{font-size:25px;font-weight:600;letter-spacing:6px;text-align:center}button{border:0;border-radius:26px;background:linear-gradient(105deg,#8c65c5,#a080d4);color:#fff;font-size:19px;line-height:26px;font-weight:700;cursor:pointer}button:hover{filter:brightness(.96)}a{display:block;margin-top:20px;color:var(--link);font-size:14px;text-underline-offset:4px}.error{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);color:var(--danger)}small{color:var(--muted);font-size:10px;font-weight:600;letter-spacing:1.5px}.back{text-align:center;margin:22px 0 0}@media(max-width:380px){.card{padding:24px 20px}h1{font-size:27px}}
</style></head><body><main><header><img src="/icons/lean-loop-v3.svg" alt=""><span>Lean Muscle</span></header><section class="card"><small>YOUR PROGRESS, YOUR SPACE</small><h1>${verify?'Check your email':'Your tracker, one code away.'}</h1>${message?`<p role="alert" class="error">${escape(message)}</p>`:''}<form method="post" action="${verify?'/auth/callback':'/sso/login'}"><input type="hidden" name="csrf" value="${escape(flow.csrf)}">${form}</form></section><a class="back" href="/">Back to tracker</a></main></body></html>`,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Set-Cookie':flowCookie(flow)}});
}
async function authRequest(path:string,body:unknown) {
  const base=new URL(process.env.SUPABASE_URL!);
  if(base.protocol!=='https:'||!process.env.SUPABASE_PUBLISHABLE_KEY)throw Error('Email sign-in is not configured.');
  try {
    return await fetch(new URL('/auth/v1/'+path,base),{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  }catch(error){
    const reason=error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'timeout':'network';
    console.error('Supabase Auth request unavailable',{operation:path,reason});
    throw new AuthServiceError('The email sign-in service is temporarily unavailable. Please try again shortly.');
  }
}
async function otpSendError(response:Response) {
  let body:{code?:unknown;error_code?:unknown}={};try{body=await response.json();}catch{}
  const value=body.code??body.error_code;
  const known=['over_email_send_rate_limit','over_request_rate_limit','email_address_not_authorized','email_provider_disabled','signup_disabled','captcha_failed','unexpected_failure'];
  const code=typeof value==='string'&&known.includes(value)?value:'unknown';
  console.error('Supabase OTP request rejected',{status:response.status,code});
  if(response.status===429||code==='over_email_send_rate_limit'||code==='over_request_rate_limit')return new AuthServiceError('The email service is limiting code requests. Wait a few minutes before requesting another code.',429);
  if(code==='email_address_not_authorized')return new AuthServiceError('Email delivery is not configured for this address yet. The tracker administrator needs to check Supabase custom SMTP.');
  if(code==='email_provider_disabled'||code==='signup_disabled')return new AuthServiceError('Email sign-in is not available yet. Please contact the tracker administrator.');
  return new AuthServiceError('The email service could not send your code. Please try again shortly. If it continues, the tracker administrator needs to check Supabase Auth and Resend email logs.');
}
export async function login(request:Request) {
  if(process.env.TRACKER_AUTH_MODE!=='supabase')return new Response('Not found',{status:404});
  if(request.method==='GET') {
    if(!env.TRACKER_SESSION_SECRET||env.TRACKER_SESSION_SECRET.length<32)return new Response('Sign-in is not configured.',{status:503,headers});
    return page({csrf:randomBytes(32).toString('base64url'),next:safeAuthReturn(new URL(request.url).searchParams.get('next')),expires:Date.now()+600000,theme:new URL(request.url).searchParams.get('theme')==='dark'?'dark':'light'});
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
    if(!response.ok)throw await otpSendError(response);
    console.info('Supabase OTP request accepted',{status:response.status});
    return page({...flow,email,csrf:randomBytes(32).toString('base64url'),expires:Date.now()+600000,theme:new URL(request.url).searchParams.get('theme')==='dark'?'dark':'light'});
  }catch(error){return flow?page(flow,error instanceof Error?error.message:'Sign-in unavailable.',error instanceof AuthServiceError?error.status:400):new Response('Start again at /sso/login.',{status:400,headers});}
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
  }catch(error){return flow?page(flow,error instanceof Error?error.message:'Sign-in unavailable.',error instanceof AuthServiceError?error.status:400):new Response('Start again at /sso/login.',{status:400,headers});}
}
