import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const directory=mkdtempSync(join(tmpdir(),'accounts-http-')),origin='https://tracker.example.test';
const settings={...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',TRACKER_AUTH_MODE:'cognito',TRACKER_OWNER_ID:'synthetic-owner',TRACKER_ACCESS_CODE:'5678',TRACKER_SESSION_SECRET:'synthetic-account-http-session-secret-at-least-32-characters',TRACKER_MCP_TOKEN:'',PUBLIC_BASE_URL:origin,COGNITO_USER_POOL_ID:'ap-south-1_Synthetic',COGNITO_CLIENT_ID:'synthetic-cognito-client',COGNITO_CLIENT_SECRET:'',COGNITO_DOMAIN:'https://synthetic.auth.ap-south-1.amazoncognito.com',COGNITO_OWNER_SUB:'synthetic-owner-sub',OAUTH_CLIENT_ID:'synthetic-chatgpt',OAUTH_CLIENT_SECRET:'',OAUTH_REDIRECT_URIS:'https://client.example.test/callback',DATABASE_DRIVER:'sqlite',DATABASE_PATH:join(directory,'accounts.sqlite'),DATABASE_AUTO_MIGRATE:'1',DATABASE_URL:'',DATABASE_SSL_MODE:'disable'};
let admin,schema;
if(process.env.TEST_DATABASE_URL){
 const {default:pg}=await import('pg');admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});schema='accounts_http_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);Object.assign(settings,{DATABASE_DRIVER:'postgres',DATABASE_URL:url.href});
}
Object.assign(process.env,settings);
const {env}=await import('../backend/services/runtime.ts');
const {accountForSubject}=await import('../backend/services/accounts.ts');
const {createTrackerSessionCookie}=await import('../backend/services/access.ts');
const users=await Promise.all([accountForSubject('synthetic-owner-sub'),accountForSubject('synthetic-other-sub')]);
const cookies=await Promise.all(users.map(async id=>(await createTrackerSessionCookie(id)).split(';')[0]));
let processes=[];let logs='';
const bases=['http://127.0.0.1:5184','http://127.0.0.1:5185'];
async function start(index){
 const child=spawn(process.execPath,['scripts/start.mjs'],{env:{...settings,PORT:String(5184+index),REPLICA_ID:'synthetic-'+index},stdio:['ignore','pipe','pipe']});
 const exit=new Promise(resolve=>child.once('exit',resolve));processes[index]={child,exit};child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Account server exited: '+logs);try{if((await fetch(bases[index]+'/api/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('Account server did not start: '+logs);
}
async function stop(index){const p=processes[index];if(p){p.child.kill('SIGTERM');await p.exit;processes[index]=null;}}
const request=(index,path,cookie,extra={})=>fetch(bases[index]+path,{redirect:'manual',...extra,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...extra.headers}});
async function grant(cookie){
 const verifier='synthetic-http-pkce-verifier-which-is-longer-than-43-characters';
 const params=new URLSearchParams({client_id:settings.OAUTH_CLIENT_ID,redirect_uri:settings.OAUTH_REDIRECT_URIS,response_type:'code',resource:origin+'/mcp',scope:'tracker',state:'synthetic-state',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
 const path='/oauth/authorize?'+params;
 const approval=await request(0,path,cookie);assert.equal(approval.status,200);
 const proof=(await approval.text()).match(/name="consent" value="([a-f0-9]+)"/)[1];
 const accepted=await request(1,path,cookie,{method:'POST',body:new URLSearchParams({consent:proof})});assert.equal(accepted.status,303);
 const code=new URL(accepted.headers.get('location')).searchParams.get('code');
 const exchanged=await request(0,'/oauth/token',null,{method:'POST',body:new URLSearchParams({client_id:settings.OAUTH_CLIENT_ID,resource:origin+'/mcp',grant_type:'authorization_code',redirect_uri:settings.OAUTH_REDIRECT_URIS,code,code_verifier:verifier})});assert.equal(exchanged.status,200);return exchanged.json();
}
try{
 await Promise.all([start(0),start(1)]);
 for(const baseIndex of [0,1]){
  assert.equal((await request(baseIndex,'/api/dashboard')).status,401);
  const access=await (await request(baseIndex,'/api/access',cookies[0])).json();assert.equal(access.authMode,'cognito');assert.equal(access.authorized,true);
  assert.equal((await request(baseIndex,'/api/access',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'5678'})})).status,403);
 }
 const login=await request(0,'/sso/login');assert.equal(login.status,302);assert.equal(new URL(login.headers.get('location')).searchParams.get('code_challenge_method'),'S256');
 assert.equal((await request(1,'/sso/callback?code=forged&state=forged')).status,401);
 const tokens=await Promise.all(cookies.map(grant));
 for(let i=0;i<2;i++){
  const write=await request(i,'/mcp',null,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[i].access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'tracker_log_meal',arguments:{date:'2026-10-12',name:'Synthetic account '+i,calories:100+i,protein:10,carbs:10,fat:2}}})});
  assert.equal(write.status,200);assert.equal((await write.json()).result.isError,undefined);
 }
 for(const replica of [0,1])for(let i=0;i<2;i++){
  const data=await (await request(replica,'/api/dashboard?date=2026-10-12',cookies[i])).json();assert.deepEqual(data.meals.map(m=>m.name),['Synthetic account '+i]);
 }

 // Manual forms and MCP share the same per-account records across replicas.
 const manualIds=[];
 for(let i=0;i<2;i++){
  const id=randomUUID();manualIds.push(id);
  const data={date:'2026-10-12',name:'Synthetic manual '+i,calories:123,protein:12,carbs:15,fat:3};
  const post=()=>request(0,'/api/records',cookies[i],{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'meal',id,data})});
  assert.equal((await post()).status,200);assert.equal((await post()).status,200);
  const read=await request(1,'/api/records?date=2026-10-12',cookies[i]);const records=await read.json();assert.equal(records.meals.filter(m=>m.id===id).length,1);assert.ok(records.meals.some(m=>m.source==='manual'));
  const rpc=await request(1,'/mcp',null,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[i].access_token},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'tracker_get_day',arguments:{date:'2026-10-12'}}})});
  const result=JSON.parse((await rpc.json()).result.content[0].text);assert.ok(result.meals.some(m=>m.id===id));assert.equal(result.meals.length,2);
  const patch=await request(1,'/api/records',cookies[i],{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'meal',id,data:{calories:150}})});assert.equal(patch.status,200);
 }
 const forbidden=await request(1,'/api/records',cookies[1],{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'meal',id:manualIds[0]})});assert.equal(forbidden.status,404);
 await stop(0);await start(0);
 for(let i=0;i<2;i++)assert.deepEqual((await (await request(0,'/api/dashboard?date=2026-10-12',cookies[i])).json()).meals.map(m=>m.name).sort(),['Synthetic account '+i,'Synthetic manual '+i].sort());
 console.log('Account HTTP smoke passed: two replicas, scoped sessions/consent/MCP records, manual/MCP interoperability, duplicate prevention, PIN disabled, invalid callback rejected and restart persistence.');
}finally{
 await Promise.all([stop(0),stop(1)]);await env.DB.close?.();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}rmSync(directory,{recursive:true,force:true});
}
