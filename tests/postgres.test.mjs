import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const {openPostgres,postgresSql,postgresConfig}=await import('../backend/services/postgres.ts');
test('Database URL options cannot override verified TLS or the configured host',()=>{
 for(const option of ['ssl=no-verify','ssl=0','sslmode=disable','sslnegotiation=direct','host=other.example.test','password=override']) {
  assert.throws(()=>postgresConfig('postgresql://synthetic-owner:synthetic-password@db.example.test/tracker?'+option),/Unsupported/);
 }
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
  assert.equal((await a.db.prepare('SELECT COUNT(*) count FROM schema_migrations').bind().first()).count,1);
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
 test('PostgreSQL CRUD operations, owner isolation, and cross-pool consistency', async () => {
  await a.db.prepare('INSERT INTO water_intakes (id,user_id,date,amount_ml,note) VALUES (?,?,?,?,?)').bind('water-owner-1','synthetic-owner','2026-10-12',500,'Morning glass').run();
  await a.db.prepare('INSERT INTO water_intakes (id,user_id,date,amount_ml,note) VALUES (?,?,?,?,?)').bind('water-other-1','other-owner','2026-10-12',750,'Private glass').run();
  await a.db.prepare('INSERT INTO body_weights (id,user_id,date,weight_kg,record_type,context) VALUES (?,?,?,?,?,?)').bind('weight-owner-1','synthetic-owner','2026-10-12',62.5,'weigh_in','morning fasting').run();
  await a.db.prepare('INSERT INTO body_weights (id,user_id,date,weight_kg,record_type,context) VALUES (?,?,?,?,?,?)').bind('weight-other-1','other-owner','2026-10-12',80.0,'weigh_in','other user').run();
  await a.db.prepare('INSERT INTO workouts (id,user_id,date,session,volume_kg,details,exercises) VALUES (?,?,?,?,?,?,?)').bind('workout-owner-1','synthetic-owner','2026-10-12','Legs',4500,'Heavy squats','[]').run();

  const ownerWater = await b.db.prepare('SELECT id,amount_ml FROM water_intakes WHERE user_id=? ORDER BY created_at ASC').bind('synthetic-owner').all();
  assert.deepEqual(ownerWater.results.map(r => r.id), ['water-owner-1']);
  assert.equal(ownerWater.results[0].amount_ml, 500);

  const otherWater = await b.db.prepare('SELECT id FROM water_intakes WHERE user_id=?').bind('other-owner').all();
  assert.deepEqual(otherWater.results.map(r => r.id), ['water-other-1']);

  const ownerWeight = await b.db.prepare('SELECT weight_kg FROM body_weights WHERE user_id=? AND id=?').bind('synthetic-owner', 'weight-owner-1').first();
  assert.equal(ownerWeight.weight_kg, 62.5);

  const leakedWeight = await b.db.prepare('SELECT weight_kg FROM body_weights WHERE user_id=? AND id=?').bind('synthetic-owner', 'weight-other-1').first();
  assert.equal(leakedWeight, null);

  await b.db.prepare('UPDATE water_intakes SET amount_ml=? WHERE id=? AND user_id=?').bind(650, 'water-owner-1', 'synthetic-owner').run();
  const updated = await a.db.prepare('SELECT amount_ml FROM water_intakes WHERE id=?').bind('water-owner-1').first();
  assert.equal(updated.amount_ml, 650);

  const deleted = await a.db.prepare('DELETE FROM water_intakes WHERE id=? AND user_id=?').bind('water-owner-1', 'synthetic-owner').run();
  assert.equal(deleted.meta.changes, 1);
  const missing = await b.db.prepare('SELECT id FROM water_intakes WHERE id=?').bind('water-owner-1').first();
  assert.equal(missing, null);
 });
 test('PostgreSQL persistence survives closing and reopening pool connections', async () => {
  await a.db.prepare('INSERT INTO meals (id,user_id,date,name,calories,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?)').bind('persist-meal-1','synthetic-owner','2026-10-12','Persisted Meal',350,30,25,10).run();
  const reopened = openPostgres(url.href, { autoMigrate: false });
  await reopened.ready;
  try {
   const persisted = await reopened.db.prepare('SELECT name, calories, protein FROM meals WHERE id=?').bind('persist-meal-1').first();
   assert.deepEqual(persisted, { name: 'Persisted Meal', calories: 350, protein: 30 });
  } finally {
   await reopened.close();
  }
 });
 test.after(async()=>{await env.DB.close?.();await Promise.all([a.close(),b.close()]);await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
}
