import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const {openPostgres,postgresSql,postgresConfig}=await import('../backend/services/postgres.ts');
const {databaseFailure,readinessFailure}=await import('../backend/services/diagnostics.ts');
test('Database diagnostics identify failures without logging credentials or raw messages',()=>{
 const secret='postgresql://private-user:private-password@private-host/db';
 assert.deepEqual(databaseFailure({code:'SELF_SIGNED_CERT_IN_CHAIN',message:'certificate not trusted '+secret}),{category:'database-tls',code:'SELF_SIGNED_CERT_IN_CHAIN'});
 assert.deepEqual(databaseFailure({code:'28P01',message:'password authentication failed '+secret}),{category:'database-authentication',code:'28P01'});
 assert.deepEqual(databaseFailure({message:'The options.ca option is not implemented '+secret}),{category:'runtime-unsupported-option',code:'UNKNOWN'});
 assert.ok(!JSON.stringify(databaseFailure({message:secret,code:secret})).includes('private-'));
});
test('Readiness detail redacts URLs, decoded database passwords, usernames and session secrets',()=>{
 const keys=['DATABASE_URL','TRACKER_SESSION_SECRET'];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  process.env.DATABASE_URL='postgresql://private-user:private%40password@private-host/db';
  process.env.TRACKER_SESSION_SECRET='synthetic-private-session-key';
  const result=readinessFailure(new Error('Connection closed '+process.env.DATABASE_URL+' private@password private-user '+process.env.TRACKER_SESSION_SECRET));
  assert.match(result.detail,/Connection closed/);
  for(const value of [process.env.DATABASE_URL,'private@password','private-user',process.env.TRACKER_SESSION_SECRET])assert.ok(!result.detail.includes(value));
  assert.equal(readinessFailure('Connection terminated unexpectedly').detail,'Connection terminated unexpectedly');
 }finally{for(const k of keys)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
});
test('Database URL options cannot override verified TLS or the configured host',()=>{
 for(const option of ['ssl=no-verify','ssl=0','sslmode=disable','sslnegotiation=direct','host=other.example.test','password=override']) {
  assert.throws(()=>postgresConfig('postgresql://synthetic-owner:synthetic-password@db.example.test/tracker?'+option),/Unsupported/);
 }
});
test('Inline database CA reaches pg without disabling certificate or hostname verification',()=>{
 const keys=['DATABASE_SSL_MODE','DATABASE_SSL_CA','DATABASE_SSL_CA_FILE'];
 const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  process.env.DATABASE_SSL_MODE='verify-full';
  delete process.env.DATABASE_SSL_CA_FILE;
  delete process.env.DATABASE_SSL_CA;
  const url='postgresql://synthetic-owner:synthetic-password@db.example.test/tracker';
  assert.deepEqual(postgresConfig(url).ssl,{rejectUnauthorized:true});
  const ca='-----BEGIN CERTIFICATE-----\nsynthetic-ca-fixture\n-----END CERTIFICATE-----';
  process.env.DATABASE_SSL_CA=ca;
  assert.deepEqual(postgresConfig(url).ssl,{rejectUnauthorized:true,ca});
  assert.equal(postgresConfig(url).ssl.checkServerIdentity,undefined);
 } finally {
  for(const k of keys)if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];
 }
});
test('Hyperdrive uses its internal binding transport without weakening direct database TLS',()=>{
 const mode=process.env.DATABASE_SSL_MODE;
 try {
  process.env.DATABASE_SSL_MODE='verify-full';
  const uri='postgresql://synthetic:synthetic@internal-binding/db';
  assert.equal(postgresConfig(uri,'hyperdrive').ssl,false);
  assert.equal(postgresConfig(uri).ssl.rejectUnauthorized,true);
 }finally{if(mode===undefined)delete process.env.DATABASE_SSL_MODE;else process.env.DATABASE_SSL_MODE=mode;}
});
test('PostgreSQL binds placeholders without changing quoted values or rowid text',()=>{
 assert.equal(postgresSql("SELECT rowid, '?' AS question, 'rowid' AS name WHERE id=? AND date=?"),"SELECT record_order, '?' AS question, 'rowid' AS name WHERE id=$1 AND date=$2");
});
if (!process.env.TEST_DATABASE_URL) {
 test('Real PostgreSQL integration (requires TEST_DATABASE_URL)', {skip:true},()=>{});
} else {
 const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 const schema='tracker_test_'+randomUUID().replaceAll('-','');
 await admin.query('CREATE SCHEMA '+schema);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
 process.env.DATABASE_URL=url.href;process.env.DATABASE_DRIVER='postgres';process.env.DATABASE_AUTO_MIGRATE='1';process.env.DATABASE_SSL_MODE='disable';
 process.env.PUBLIC_BASE_URL='https://tracker.example.test';process.env.TRACKER_OWNER_ID='synthetic-owner';process.env.TRACKER_ACCESS_CODE='5678';process.env.TRACKER_SESSION_SECRET='synthetic-postgres-session-secret-at-least-32-characters';
 process.env.OAUTH_CLIENT_ID='synthetic-client';process.env.OAUTH_CLIENT_SECRET='synthetic-postgres-client-secret-at-least-32-characters';process.env.OAUTH_REDIRECT_URIS='https://client.example.test/callback';
 const a=openPostgres(url.href,{autoMigrate:true}),b=openPostgres(url.href,{autoMigrate:true});
 await Promise.all([a.ready,b.ready]);
 const {env}=await import('../backend/services/runtime.ts');
 const {allowAttempt}=await import('../backend/services/security.ts');
 const oauth=await import('../backend/api/oauth.ts');
 test('Concurrent migrations produce one shared schema; records and numeric JSON types agree across pools',async()=>{
  assert.equal((await a.db.prepare('SELECT COUNT(*) count FROM schema_migrations').bind().first()).count,2);
  await a.db.prepare('INSERT INTO meals (id,user_id,date,name,calories,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?)').bind('synthetic-shared','synthetic-owner','2026-10-12','Literal ? rowid meal',100,5,10,4).run();
  const row=await b.db.prepare('SELECT name,SUM(calories) calories,COUNT(*) count FROM meals GROUP BY name').bind().first();
  assert.deepEqual(row,{name:'Literal ? rowid meal',calories:100,count:1});
  assert.equal(typeof row.count,'number');
  assert.ok((await b.db.prepare('SELECT rowid FROM meals WHERE id=?').bind('synthetic-shared').first()).record_order>0);
  await assert.rejects(()=>a.db.transaction(async tx=>{await tx.prepare('DELETE FROM meals WHERE id=?').bind('synthetic-shared').run();throw Error('Synthetic rollback');}));
  assert.ok(await b.db.prepare('SELECT id FROM meals WHERE id=?').bind('synthetic-shared').first());
 });
 test('Atomic shared throttling admits exactly ten of fifty concurrent attempts, then resets the window',async()=>{
  await env.DB.prepare('DELETE FROM auth_attempts').bind().run();
  const responses=await Promise.all(Array.from({length:50},()=>allowAttempt('concurrent-owner')));
  assert.equal(responses.filter(Boolean).length,10);
  assert.equal((await b.db.prepare('SELECT attempts FROM auth_attempts WHERE key=?').bind('concurrent-owner').first()).attempts,50);
  await b.db.prepare('UPDATE auth_attempts SET reset_at=0 WHERE key=?').bind('concurrent-owner').run();
  assert.equal(await allowAttempt('concurrent-owner'),true);
 });
 test('Concurrent OAuth exchanges and refreshes consume a shared credential only once',async()=>{
  const origin=process.env.PUBLIC_BASE_URL,resource=origin+'/mcp',verifier='v'.repeat(43);
  const params=new URLSearchParams({client_id:process.env.OAUTH_CLIENT_ID,redirect_uri:process.env.OAUTH_REDIRECT_URIS,response_type:'code',resource,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
  const consent=await oauth.authorize(new Request(origin+'/oauth/authorize?'+params,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:'5678'})}));assert.equal(consent.status,303);
  const code=new URL(consent.headers.get('location')).searchParams.get('code');
  const exchange=extra=>oauth.token(new Request(origin+'/oauth/token',{method:'POST',body:new URLSearchParams({client_id:process.env.OAUTH_CLIENT_ID,client_secret:process.env.OAUTH_CLIENT_SECRET,resource,...extra})}));
  const results=await Promise.all(Array.from({length:8},()=>exchange({grant_type:'authorization_code',code,redirect_uri:process.env.OAUTH_REDIRECT_URIS,code_verifier:verifier})));
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===400).length,7);
  const granted=await results.find(r=>r.status===200).json();
  const refreshed=await Promise.all(Array.from({length:8},()=>exchange({grant_type:'refresh_token',refresh_token:granted.refresh_token})));
  assert.equal(refreshed.filter(r=>r.status===200).length,1);assert.equal(refreshed.filter(r=>r.status===400).length,7);
  assert.equal((await b.db.prepare("SELECT COUNT(*) count FROM oauth_tokens WHERE kind='refresh'").bind().first()).count,1);
 });
 test.after(async()=>{await env.DB.close?.();await Promise.all([a.close(),b.close()]);await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
}
