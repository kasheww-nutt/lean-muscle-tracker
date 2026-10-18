import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const directory=mkdtempSync(join(tmpdir(),'cloudflare-tracker-'));
Object.assign(process.env,{DATABASE_DRIVER:'sqlite',DATABASE_PATH:join(directory,'accounts.sqlite'),PUBLIC_BASE_URL:'https://tracker.example.test',TRACKER_AUTH_MODE:'supabase',TRACKER_OWNER_ID:'synthetic-owner',TRACKER_SESSION_SECRET:'synthetic-workers-session-secret-at-least-32-characters',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable-key'});
const {env,withRequestDatabase}=await import('../backend/services/runtime.ts');
const {trackerUser}=await import('../backend/services/access.ts');
const auth=await import('../backend/api/supabase-auth.ts');
const {routeRequest}=await import('../infrastructure/cloudflare/router.ts');
const origin=process.env.PUBLIC_BASE_URL,originalFetch=globalThis.fetch;
const cookie=r=>r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const csrf=async r=>(await r.text()).match(/name="csrf" value="([^"]+)"/)[1];
function post(path,body,cookies,requestOrigin=origin){return new Request(origin+path,{method:'POST',headers:{Origin:requestOrigin,Cookie:cookies,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});}
test('Supabase OTP login requires browser state and verified identity, then issues an account-scoped cookie',async()=>{
 let endpoint='',unverified=false;
 globalThis.fetch=async(url,options)=>{
  endpoint=new URL(url).pathname;
  assert.equal(options.headers.apikey,'synthetic-publishable-key');
  if(endpoint.endsWith('/otp'))return Response.json({});
  if(endpoint.endsWith('/verify')){const b=JSON.parse(options.body);assert.equal(b.type,'email');assert.equal(b.email,'person@example.test');return Response.json({access_token:'synthetic-supabase-token'});}
  assert.equal(options.headers.Authorization,'Bearer synthetic-supabase-token');
  return Response.json({id:'11111111-1111-4111-8111-111111111111',email:'person@example.test',email_confirmed_at:unverified?null:'2026-10-18T00:00:00Z'});
 };
 const start=await auth.login(new Request(origin+'/sso/login?next='+encodeURIComponent('/oauth/authorize?client_id=test')));
 const firstCookie=cookie(start),firstCsrf=await csrf(start);
 assert.equal((await auth.login(post('/sso/login',{email:'person@example.test',csrf:firstCsrf},firstCookie,'https://attacker.example.test'))).status,403);
 assert.equal((await auth.login(post('/sso/login',{email:'person@example.test',csrf:'wrong'},firstCookie))).status,400);
 const sent=await auth.login(post('/sso/login',{email:'person@example.test',csrf:firstCsrf},firstCookie));
 assert.equal(sent.status,200);assert.equal(endpoint,'/auth/v1/otp');
 const flowCookie=cookie(sent),flowCsrf=await csrf(sent);
 unverified=true;
 assert.equal((await auth.callback(post('/auth/callback',{token:'123456',csrf:flowCsrf},flowCookie))).status,400);
 unverified=false;
 const signedIn=await auth.callback(post('/auth/callback',{token:'123456',csrf:flowCsrf},flowCookie));
 assert.equal(signedIn.status,303);assert.equal(signedIn.headers.get('location'),origin+'/oauth/authorize?client_id=test');
 const user=await trackerUser(new Request(origin,{headers:{Cookie:cookie(signedIn)}}));
 assert.ok(user.startsWith('account_'));assert.notEqual(user,'synthetic-owner');
 assert.equal((await auth.callback(post('/auth/callback',{token:'123456',csrf:flowCsrf},flowCookie+'tampered'))).status,400);
 assert.equal(auth.safeAuthReturn('https://attacker.example.test/oauth/authorize'),'/');
 globalThis.fetch=originalFetch;
});
test('Request-scoped database access stays isolated across concurrent Workers requests',async()=>{
 const a={},b={};
 await Promise.all([withRequestDatabase(()=>a,async()=>{await new Promise(r=>setTimeout(r,12));assert.equal(env.DB,a);}),withRequestDatabase(()=>b,async()=>{await new Promise(r=>setTimeout(r,2));assert.equal(env.DB,b);})]);
});
test('Router distributes traffic, skips unhealthy replicas and never retries an ambiguous write',async()=>{
 let a=0,b=0,unhealthy=false,failWrite=false;
 const service=name=>({fetch:async request=>{
  if(new URL(request.url).pathname==='/api/health')return Response.json({replica:name},{status:name==='a'&&unhealthy?503:200});
  name==='a'?a++:b++;
  if(name==='a'&&failWrite)throw Error('Connection lost after commit');
  return Response.json({replica:name},{headers:{'X-Tracker-Replica':name}});
 }});
 const bindings={BACKEND_A:service('a'),BACKEND_B:service('b'),ASSETS:{fetch:async()=>new Response('static dashboard')},PUBLIC_BASE_URL:origin};
 assert.equal((await (await routeRequest(new Request(origin+'/api/health'),bindings,()=>0)).json()).replica,'a');
 assert.equal((await (await routeRequest(new Request(origin+'/api/health'),bindings,()=>1)).json()).replica,'b');
 unhealthy=true;assert.equal((await (await routeRequest(new Request(origin+'/api/ready'),bindings,()=>0)).json()).replica,'b');
 // Targeted readiness cannot accidentally verify the other replica.
 assert.equal((await routeRequest(new Request(origin+'/api/ready?replica=replica-a'),bindings,()=>1)).status,503);
 unhealthy=false;
 assert.equal((await (await routeRequest(new Request(origin+'/api/ready?replica=replica-a'),bindings,()=>1)).json()).replica,'a');
 assert.equal((await routeRequest(new Request(origin+'/api/ready?replica=other'),bindings)).status,400);
 failWrite=true;const previousB=b;
 assert.equal((await routeRequest(new Request(origin+'/api/records',{method:'POST',body:'synthetic'}),bindings,()=>0)).status,503);
 assert.equal(b,previousB);
 assert.equal((await routeRequest(new Request('https://attacker.example.test/api/records'),bindings)).status,404);
 assert.equal(await (await routeRequest(new Request(origin+'/'),bindings)).text(),'static dashboard');
 assert.ok(a>0&&b>0);
});
test.after(async()=>{globalThis.fetch=originalFetch;await env.DB.close?.();rmSync(directory,{recursive:true,force:true});});
