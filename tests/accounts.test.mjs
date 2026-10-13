import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const directory=mkdtempSync(join(tmpdir(),'tracker-accounts-'));
process.env.DATABASE_DRIVER='sqlite';process.env.DATABASE_PATH=join(directory,'tracker.sqlite');
process.env.PUBLIC_BASE_URL='https://tracker.example.test';process.env.TRACKER_OWNER_ID='original-owner';
process.env.TRACKER_ACCESS_CODE='5678';process.env.TRACKER_SESSION_SECRET='synthetic-accounts-session-secret-at-least-32-characters';
process.env.COGNITO_USER_POOL_ID='ap-south-1_Synthetic';process.env.COGNITO_CLIENT_ID='synthetic-client';
process.env.COGNITO_DOMAIN='https://synthetic.auth.ap-south-1.amazoncognito.com';process.env.COGNITO_OWNER_SUB='owner-subject';
process.env.OAUTH_CLIENT_ID='synthetic-chatgpt';process.env.OAUTH_CLIENT_SECRET='';process.env.OAUTH_REDIRECT_URIS='https://client.example.test/callback';
let admin,schema;
if(process.env.TEST_DATABASE_URL){
 const {default:pg}=await import('pg');admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 schema='accounts_test_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
 process.env.DATABASE_URL=url.href;process.env.DATABASE_DRIVER='postgres';process.env.DATABASE_SSL_MODE='disable';process.env.DATABASE_AUTO_MIGRATE='1';
}
const {env}=await import('../backend/services/runtime.ts');
await env.DB.prepare('SELECT COUNT(*) count FROM tracker_accounts').bind().first();
const {accountForSubject}=await import('../backend/services/accounts.ts');
const {createTrackerSessionCookie,trackerUser}=await import('../backend/services/access.ts');
const access=await import('../backend/api/access.ts');const oauth=await import('../backend/api/oauth.ts');
const sso=await import('../backend/api/sso.ts');const mcp=await import('../backend/mcp/handler.ts');
const dashboard=await import('../backend/api/dashboard.ts');const history=await import('../backend/api/history.ts');const widget=await import('../backend/api/widget.ts');
const origin=process.env.PUBLIC_BASE_URL,resource=origin+'/mcp',date='2026-10-12';
const cookie=async user=>(await createTrackerSessionCookie(user)).split(';')[0];
const req=(path,userCookie,method='GET',body)=>new Request(origin+path,{method,headers:{Cookie:userCookie||'',Origin:origin,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:new URLSearchParams(body)}:{})});
const call=async(token,name,args)=>{
 const response=await mcp.POST(new Request(resource,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));
 const body=await response.json();if(response.status!==200)throw Error(JSON.stringify(body));return body;
};
const result=rpc=>JSON.parse(rpc.result.content[0].text);
const exchange=extra=>oauth.token(new Request(origin+'/oauth/token',{method:'POST',body:new URLSearchParams({client_id:process.env.OAUTH_CLIENT_ID,resource,...extra})}));
async function grant(userCookie){
 const verifier='synthetic-accounts-pkce-verifier-that-is-longer-than-43-characters';
 const params=new URLSearchParams({client_id:process.env.OAUTH_CLIENT_ID,redirect_uri:process.env.OAUTH_REDIRECT_URIS,response_type:'code',resource,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state:'synthetic-state'});
 const path='/oauth/authorize?'+params;
 const html=await (await oauth.authorize(req(path,userCookie))).text();const consent=html.match(/name="consent" value="([a-f0-9]+)"/)[1];
 const approved=await oauth.authorize(req(path,userCookie,'POST',{consent}));assert.equal(approved.status,303);
 const code=new URL(approved.headers.get('location')).searchParams.get('code');
 const response=await exchange({grant_type:'authorization_code',code,redirect_uri:process.env.OAUTH_REDIRECT_URIS,code_verifier:verifier});assert.equal(response.status,200);
 assert.equal((await exchange({grant_type:'authorization_code',code,redirect_uri:process.env.OAUTH_REDIRECT_URIS,code_verifier:verifier})).status,400);
 return response.json();
}
test('Accounts preserve original owner data, isolate website/MCP/widgets, and bind refresh tokens to each user',async()=>{
 // Existing records and old PIN sessions precede activation.
 await env.DB.prepare('INSERT INTO water_intakes (id,user_id,date,amount_ml) VALUES (?,?,?,?)').bind('original-record','original-owner',date,111).run();
 const oldCookie=await cookie();assert.equal(await trackerUser(req('/',oldCookie)),'original-owner');
 process.env.TRACKER_AUTH_MODE='cognito';assert.equal(await trackerUser(req('/',oldCookie)),null);
 assert.equal((await access.POST(new Request(origin+'/api/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({code:'5678'})}))).status,403);
 const [owner,other]=await Promise.all([accountForSubject('owner-subject'),accountForSubject('other-subject')]);
 assert.equal(owner,'original-owner');assert.notEqual(other,owner);assert.equal(await accountForSubject('other-subject'),other);
 const [ownerCookie,otherCookie]=await Promise.all([cookie(owner),cookie(other)]);
 assert.equal(await trackerUser(req('/',ownerCookie)),owner);assert.equal(await trackerUser(req('/',otherCookie)),other);
 assert.equal(await trackerUser(req('/',otherCookie.slice(0,-1)+'z')),null);
 assert.equal(await trackerUser(req('/',await cookie('unregistered'))),null);
 let first=await (await dashboard.GET(req('/api/dashboard?date='+date,ownerCookie))).json();assert.equal(first.waterTotalMl,111);
 assert.equal((await (await dashboard.GET(req('/api/dashboard?date='+date,otherCookie))).json()).waterTotalMl,0);
 const unauth=await oauth.authorize(req('/oauth/authorize?'+new URLSearchParams({client_id:process.env.OAUTH_CLIENT_ID,redirect_uri:process.env.OAUTH_REDIRECT_URIS,response_type:'code',resource,code_challenge_method:'S256',code_challenge:'a'.repeat(43)})));
 assert.equal(unauth.status,303);assert.ok(unauth.headers.get('location').startsWith(origin+'/sso/login?next='));
 const [ownerGrant,otherGrant]=await Promise.all([grant(ownerCookie),grant(otherCookie)]);
 const ownMeal=result(await call(ownerGrant.access_token,'tracker_log_meal',{date,name:'Owner meal',calories:100,protein:10,carbs:10,fat:2}));
 const otherMeal=result(await call(otherGrant.access_token,'tracker_log_meal',{date,name:'Other meal',calories:200,protein:20,carbs:20,fat:4,user_id:owner}));
 assert.ok(ownMeal.id);assert.ok(otherMeal.id);
 for(const [token,weight,session] of [[ownerGrant.access_token,54,'Owner training'],[otherGrant.access_token,70,'Other training']]) {
  await call(token,'tracker_log_weight',{date,weight_kg:weight,user_id:owner});
  await call(token,'tracker_log_workout',{date,session,volume_kg:100,user_id:owner});
 }
 for(const [token,weight,session,name] of [[ownerGrant.access_token,54,'Owner training','Owner meal'],[otherGrant.access_token,70,'Other training','Other meal']]) {
  const data=result(await call(token,'tracker_get_history',{}));
  assert.deepEqual(result(await call(token,'tracker_get_day',{date})).meals.map(m=>m.name),[name]);
  assert.equal(data.nutrition[0].calories,name==='Owner meal'?100:200);
  assert.deepEqual(data.weights.map(w=>w.weight_kg),[weight]);
  assert.deepEqual(data.workouts.map(w=>w.session),[session]);
 }

 for(const [userCookie,expected] of [[ownerCookie,'Owner meal'],[otherCookie,'Other meal']]){
  const data=await (await dashboard.GET(req('/api/dashboard?date='+date,userCookie))).json();assert.deepEqual(data.meals.map(m=>m.name),[expected]);
  const past=await (await history.GET(req('/api/history',userCookie))).json();assert.deepEqual(past.meals.map(m=>m.name),[expected]);
 }
 const forbidden=await call(otherGrant.access_token,'tracker_update_meal',{id:ownMeal.id,name:'Stolen'});assert.equal(forbidden.result.isError,true);
 const removed=result(await call(otherGrant.access_token,'tracker_remove_meal',{id:ownMeal.id}));assert.equal(removed.removed,false);
 const refreshed=await exchange({grant_type:'refresh_token',refresh_token:otherGrant.refresh_token});assert.equal(refreshed.status,200);
 const fresh=await refreshed.json();await call(fresh.access_token,'tracker_log_water',{date,amount_ml:222});
 assert.equal((await exchange({grant_type:'refresh_token',refresh_token:otherGrant.refresh_token})).status,400);
 assert.equal((await (await dashboard.GET(req('/api/dashboard?date='+date,ownerCookie))).json()).waterTotalMl,111);
 assert.equal((await (await dashboard.GET(req('/api/dashboard?date='+date,otherCookie))).json()).waterTotalMl,222);
 const ownWidget=await (await widget.POST(req('/api/widget',ownerCookie,'POST'))).json();
 const otherWidget=await (await widget.POST(req('/api/widget',otherCookie,'POST'))).json();
 assert.notEqual(ownWidget.token,otherWidget.token);
 await widget.DELETE(req('/api/widget',otherCookie,'DELETE'));
 assert.equal((await widget.GET(req('/api/widget?key='+ownWidget.token))).status,200);
 assert.equal((await widget.GET(req('/api/widget?key='+otherWidget.token))).status,401);
 const logout=await access.DELETE(req('/api/access',otherCookie,'DELETE'));assert.equal(logout.status,200);assert.ok((await logout.json()).logoutUrl.startsWith(process.env.COGNITO_DOMAIN+'/logout?'));
 // Session proof is required even for a valid signed-in account.
 const invalidConsent=await oauth.authorize(req('/oauth/authorize?'+new URLSearchParams({client_id:process.env.OAUTH_CLIENT_ID,redirect_uri:process.env.OAUTH_REDIRECT_URIS,response_type:'code',resource,code_challenge_method:'S256',code_challenge:'a'.repeat(43)}),otherCookie,'POST',{consent:'forged'}));assert.equal(invalidConsent.status,403);
 // Configuration changes cannot silently remap existing identities.
 process.env.COGNITO_OWNER_SUB='other-subject';await assert.rejects(()=>accountForSubject('other-subject'));process.env.COGNITO_OWNER_SUB='owner-subject';
});
test('SSO retains only a safe consent return URL, sets PKCE/nonce, rejects unverified accounts and invalid state',async()=>{
 assert.equal(sso.safeReturnPath('https://attacker.example.test/oauth/authorize'),'/');assert.equal(sso.safeReturnPath('//attacker.example.test/'),'/');assert.equal(sso.safeReturnPath('/other'),'/');
 const started=await sso.login(req('/sso/login?next='+encodeURIComponent('/oauth/authorize?test=1')));assert.equal(started.status,302);
 const url=new URL(started.headers.get('location'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('scope'),'openid email profile');assert.ok(url.searchParams.get('nonce'));
 assert.match(started.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 assert.equal((await sso.callback(req('/sso/callback?code=forged&state=forged'))).status,401);
});
test.after(async()=>{await env.DB.close?.();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}rmSync(directory,{recursive:true,force:true});});
