import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const {openPostgres}=await import('../backend/services/postgres.ts');
if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL is required for the two-replica production check.');
const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
const schema='replicas_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
process.env.DATABASE_SSL_MODE='disable';
const storage=openPostgres(url.href,{autoMigrate:true});await storage.ready;
const origin='https://tracker.example.test',resource=origin+'/mcp';
const token='synthetic-replicas-bearer-at-least-32-characters';
const settings={...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',DATABASE_DRIVER:'postgres',DATABASE_URL:url.href,DATABASE_AUTO_MIGRATE:'0',DATABASE_SSL_MODE:'disable',PUBLIC_BASE_URL:origin,TRACKER_OWNER_ID:'synthetic-owner',TRACKER_ACCESS_CODE:'5678',TRACKER_SESSION_SECRET:'synthetic-shared-replica-session-secret-at-least-32-characters',TRACKER_MCP_TOKEN:token,OAUTH_CLIENT_ID:'synthetic-client',OAUTH_CLIENT_SECRET:'synthetic-shared-client-secret-at-least-32-characters',OAUTH_REDIRECT_URIS:'https://client.example.test/callback',COGNITO_USER_POOL_ID:'',COGNITO_CLIENT_ID:'',COGNITO_CLIENT_SECRET:'',COGNITO_DOMAIN:'',COGNITO_OWNER_SUB:''};
const ports=[5181,5182],processes=new Map(),base=i=>'http://127.0.0.1:'+ports[i];let id=0;
async function start(i){let logs='';const child=spawn(process.execPath,['scripts/start.mjs'],{env:{...settings,PORT:String(ports[i]),REPLICA_ID:i===0?'replica-a':'replica-b'},stdio:['ignore','pipe','pipe']});const exit=new Promise(resolve=>child.once('exit',resolve));processes.set(i,{child,exit});child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);for(let k=0;k<100;k++){if(child.exitCode!==null)throw Error('Replica exited: '+logs);try{const r=await fetch(base(i)+'/api/health');if(r.ok){assert.equal((await r.json()).replica,i===0?'replica-a':'replica-b');return;}}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Replica not ready: '+logs);}
async function stop(i){const entry=processes.get(i);if(entry){entry.child.kill('SIGTERM');await entry.exit;processes.delete(i);}}
async function rpc(i,method,params={},bearer=token,extra={}){return fetch(base(i)+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bearer,...extra},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});}
async function tool(i,name,args,bearer=token){const r=await rpc(i,'tools/call',{name,arguments:args},bearer);assert.equal(r.status,200);const result=await r.json();assert.equal(result.error,undefined,JSON.stringify(result));assert.ok(!result.result.isError,JSON.stringify(result));return JSON.parse(result.result.content[0].text);}
try{
 await Promise.all([start(0),start(1)]);
 const login=await fetch(base(0)+'/api/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({code:'5678'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const read=async(i)=>{const r=await fetch(base(i)+'/api/dashboard?date=2026-10-12',{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json();};
 assert.equal((await read(1)).totals.calories,0);
 const meal=await tool(0,'tracker_log_meal',{date:'2026-10-12',name:'Synthetic shared ? rowid meal',calories:120,protein:5,carbs:10,fat:4});
 assert.equal((await read(1)).totals.calories,120);
 await tool(1,'tracker_update_meal',{id:meal.id,calories:100});assert.equal((await read(0)).totals.calories,100);
 const water=await tool(0,'tracker_log_water',{date:'2026-10-12',amount_ml:250});await tool(1,'tracker_update_water',{id:water.id,amount_ml:300});assert.equal((await read(0)).waterTotalMl,300);
 await tool(0,'tracker_log_weight',{date:'2026-10-12',weight_kg:60});await tool(1,'tracker_log_workout',{date:'2026-10-12',session:'Synthetic upper',exercises:[{name:'Press',sets:[{reps:10,load_kg:20}]}]});assert.equal((await read(0)).workouts[0].volume_kg,200);
 const history=await fetch(base(1)+'/api/history?q=shared',{headers:{Cookie:cookie}});assert.equal(history.status,200);assert.equal((await history.json()).meals.length,1);
 const literal=await fetch(base(1)+'/api/history?q='+encodeURIComponent('? rowid'),{headers:{Cookie:cookie}});assert.equal(literal.status,200);assert.equal((await literal.json()).meals.length,1);
 const widget=await fetch(base(0)+'/api/widget',{method:'POST',headers:{Origin:origin,Cookie:cookie}});assert.equal(widget.status,200);const widgetToken=(await widget.json()).token;
 const widgetRead=await fetch(base(1)+'/api/widget?day=latest&key='+widgetToken);assert.equal(widgetRead.status,200);assert.equal((await widgetRead.json()).calories,100);
 const verifier='v'.repeat(43);const auth=new URLSearchParams({client_id:settings.OAUTH_CLIENT_ID,redirect_uri:settings.OAUTH_REDIRECT_URIS,response_type:'code',resource,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
 const consent=await fetch(base(0)+'/oauth/authorize?'+auth,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:'5678'})});assert.equal(consent.status,303);
 const code=new URL(consent.headers.get('location')).searchParams.get('code');
 const grant=new URLSearchParams({grant_type:'authorization_code',client_id:settings.OAUTH_CLIENT_ID,client_secret:settings.OAUTH_CLIENT_SECRET,resource,redirect_uri:settings.OAUTH_REDIRECT_URIS,code,code_verifier:verifier});
 const exchange=i=>fetch(base(i)+'/oauth/token',{method:'POST',body:grant});const exchanged=await Promise.all([exchange(0),exchange(1)]);assert.deepEqual(exchanged.map(r=>r.status).sort(),[200,400]);const tokens=await exchanged.find(r=>r.status===200).json();
 assert.equal((await rpc(0,'ping',{},tokens.access_token)).status,200);assert.equal((await rpc(1,'ping',{},tokens.access_token)).status,200);
 const refresh=i=>fetch(base(i)+'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:settings.OAUTH_CLIENT_ID,client_secret:settings.OAUTH_CLIENT_SECRET,resource})});const refreshed=await Promise.all([refresh(0),refresh(1)]);assert.deepEqual(refreshed.map(r=>r.status).sort(),[200,400]);
 assert.equal((await rpc(0,'ping',{},token,{'MCP-Protocol-Version':'invalid-version'})).status,400);
 await stop(0);assert.equal((await read(1)).totals.calories,100);await tool(1,'tracker_update_meal',{id:meal.id,calories:110});await start(0);assert.equal((await read(0)).totals.calories,110);assert.equal((await rpc(0,'ping',{},tokens.access_token)).status,200);
 await stop(1);assert.equal((await read(0)).totals.calories,110);await start(1);assert.equal((await read(1)).totals.calories,110);
 console.log('Two-replica PostgreSQL production check passed: shared browser sessions, cross-replica records/corrections/history/widgets, concurrent OAuth/refresh replay rejection, protocol rejection and independent application restart/failure.');
}finally{await Promise.all([stop(0),stop(1)]);await storage.close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
