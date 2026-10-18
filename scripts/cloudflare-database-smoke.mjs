import {readFileSync} from 'node:fs';
import {randomUUID,createHmac,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

export async function workerDatabaseSmoke({Miniflare,convertV4MiniflareOptions,code,vars}) {
 if(!process.env.TEST_DATABASE_URL) {
  if(process.env.CI)throw Error('The Workers database gate requires TEST_DATABASE_URL in CI.');
  console.log('Workers database integration skipped locally: TEST_DATABASE_URL is unset.');
  return;
 }
 const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 const database='worker_runtime_'+randomUUID().replaceAll('-','');
 let setup,mf;
 const secret='synthetic-runtime-session-secret-at-least-32-characters';
 // Miniflare's local ingress accepts loopback Origin headers only.
 const date='2026-10-18',base='https://localhost';
 const cookie=userId=>{
  const payload='v2.'+Buffer.from(JSON.stringify({userId,expiry:Date.now()+600000})).toString('base64url');
  return 'lean_tracker_access='+payload+'.'+createHmac('sha256',secret).update(payload).digest('hex');
 };
 try {
  await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$");
  await admin.query('CREATE DATABASE '+database);
  const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+database;url.search='';
  setup=new pg.Pool({connectionString:url.href});
  await setup.query(readFileSync('infrastructure/cloudflare/supabase-first-setup.sql','utf8'));
  await setup.query("ALTER ROLE tracker_app PASSWORD 'synthetic-workers-database-password'");
  await setup.query("INSERT INTO tracker_accounts(user_id,cognito_subject) VALUES ('runtime-account-a','synthetic-runtime-subject-a'),('runtime-account-b','synthetic-runtime-subject-b')");
  url.username='tracker_app';url.password='synthetic-workers-database-password';
  const workers=['a','b'].map(replica=>({name:'runtime-'+replica,modules:[{type:'ESModule',path:'/worker.mjs',contents:code}],modulesRoot:'/',compatibilityDate:'2026-10-17',compatibilityFlags:['nodejs_compat'],bindings:{...vars,PUBLIC_BASE_URL:base,REPLICA_ID:'replica-'+replica,DATABASE_POOL_MAX:'1',TRACKER_SESSION_SECRET:secret},hyperdrives:{HYPERDRIVE:url.href}}));
  mf=new Miniflare(convertV4MiniflareOptions({workers}));
  const a=await mf.getWorker('runtime-a'),b=await mf.getWorker('runtime-b');
  const request=async(worker,path,options={})=>worker.fetch(base+path,{redirect:'manual',...options});
  const json=async(response,status=200)=>{const text=await response.text();assert.equal(response.status,status,text);return JSON.parse(text);};
  for(const [worker,replica] of [[a,'replica-a'],[b,'replica-b']])assert.equal((await json(await request(worker,'/api/ready'))).replica,replica);
  const headers={Origin:base,Cookie:cookie('runtime-account-a'),'Content-Type':'application/json'};
  const meal={date,name:'Synthetic runtime meal',calories:100,protein:10,carbs:10,fat:2.2};
  const id=randomUUID();
  for(const [kind,data] of [['meal',meal],['water',{date,amount_ml:250}],['weight',{date,weight_kg:60}],['workout',{date,session:'Synthetic',exercises:[{name:'Row',sets:[{reps:10,load_kg:20}]}]}]]) {
   await json(await request(a,'/api/records',{method:'POST',headers,body:JSON.stringify({kind,id:kind==='meal'?id:randomUUID(),data})}));
  }
  const dashboard=await json(await request(b,'/api/dashboard?date='+date,{headers:{Cookie:headers.Cookie}}));
  assert.equal(dashboard.meals[0].id,id);assert.equal(dashboard.waterTotalMl,250);assert.equal(dashboard.workouts[0].volume_kg,200);
  const isolated=await json(await request(a,'/api/dashboard?date='+date,{headers:{Cookie:cookie('runtime-account-b')}}));
  assert.equal(isolated.meals.length,0);assert.equal(isolated.waterTotalMl,0);
  await json(await request(a,'/api/saved-meals',{method:'POST',headers,body:JSON.stringify({meal_id:id})}));
  const usualMeals=await json(await request(b,'/api/saved-meals',{headers:{Cookie:headers.Cookie}}));
  assert.equal(usualMeals.meals[0].id,id);assert.equal(usualMeals.meals[0].calories,100);
  assert.equal((await json(await request(b,'/api/saved-meals',{headers:{Cookie:cookie('runtime-account-b')}}))).meals.length,0);
  await json(await request(b,'/api/saved-meals',{method:'DELETE',headers:{...headers,Cookie:cookie('runtime-account-b')},body:JSON.stringify({meal_id:id})}),404);
  const verifier='v'.repeat(43),redirect=vars.OAUTH_REDIRECT_URIS.split(',')[0],resource=base+'/mcp';
  const params=new URLSearchParams({response_type:'code',client_id:vars.OAUTH_CLIENT_ID,redirect_uri:redirect,resource,scope:'tracker',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state:'synthetic-state'});
  const authorize='/oauth/authorize?'+params;
  const consent=await request(a,authorize,{headers:{Cookie:headers.Cookie}});
  assert.equal(consent.status,200);
  const proof=(await consent.text()).match(/name="consent" value="([^"]+)"/)?.[1];assert.ok(proof);
  const approved=await request(b,authorize,{method:'POST',headers:{Cookie:headers.Cookie,Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({consent:proof})});
  assert.equal(approved.status,303);
  const authorizationCode=new URL(approved.headers.get('location')).searchParams.get('code');assert.ok(authorizationCode);
  const tokenBody={client_id:vars.OAUTH_CLIENT_ID,resource,grant_type:'authorization_code',code:authorizationCode,code_verifier:verifier,redirect_uri:redirect};
  const token=await json(await request(a,'/oauth/token',{method:'POST',body:new URLSearchParams(tokenBody)}));
  assert.ok(token.access_token);
  const tool=async(worker,name,args)=>{
   const rpc=await json(await request(worker,'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));
   assert.ok(!rpc.error,JSON.stringify(rpc));assert.ok(!rpc.result.isError,JSON.stringify(rpc));
   return JSON.parse(rpc.result.content[0].text);
  };
  assert.equal((await tool(b,'tracker_get_day',{date})).waterTotalMl,250);
  await tool(b,'tracker_log_water',{date,amount_ml:50,note:'Synthetic runtime test'});
  assert.equal((await json(await request(a,'/api/dashboard?date='+date,{headers:{Cookie:headers.Cookie}}))).waterTotalMl,300);
  assert.equal((await tool(b,'tracker_list_usual_meals',{})).meals[0].id,id);
  const usualEntry=randomUUID(),usualArgs={meal_id:id,date,servings:0.5,submission_id:usualEntry};
  await tool(a,'tracker_log_usual_meal',usualArgs);await tool(b,'tracker_log_usual_meal',usualArgs);
  const reused=await json(await request(a,'/api/records?date='+date,{headers:{Cookie:headers.Cookie}}));
  assert.equal(reused.meals.filter(m=>m.id===usualEntry).length,1);
  assert.equal(reused.meals.find(m=>m.id===usualEntry).calories,50);
  await json(await request(b,'/api/saved-meals',{method:'DELETE',headers,body:JSON.stringify({meal_id:id})}));
  assert.ok((await tool(a,'tracker_get_day',{date})).meals.some(m=>m.id===usualEntry));
  const rotated=await json(await request(b,'/oauth/token',{method:'POST',body:new URLSearchParams({client_id:vars.OAUTH_CLIENT_ID,resource,grant_type:'refresh_token',refresh_token:token.refresh_token})}));assert.ok(rotated.access_token);
  await json(await request(a,'/oauth/token',{method:'POST',body:new URLSearchParams({client_id:vars.OAUTH_CLIENT_ID,resource,grant_type:'refresh_token',refresh_token:token.refresh_token})}),400);
  console.log('Workers + Hyperdrive binding + PostgreSQL passed: both readiness checks, all four manual log types, cross-replica reads/writes, account isolation, cross-replica PKCE OAuth, MCP reads/writes, private usual meals with retry-safe scaling and single-use refresh rotation. No real user data or email touched.');
 }finally {
  await mf?.dispose();await setup?.end();
  await admin.query('DROP DATABASE IF EXISTS '+database+' WITH (FORCE)');await admin.end();
 }
}
