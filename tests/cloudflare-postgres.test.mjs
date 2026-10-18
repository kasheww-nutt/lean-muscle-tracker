import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(!process.env.TEST_DATABASE_URL){
 test('Cloudflare restricted database role and fresh Supabase schema (requires TEST_DATABASE_URL)',{skip:true},()=>{});
}else{
 test('Fresh Supabase schema supports the restricted backend role and blocks public API roles',async()=>{
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  const database='worker_test_'+randomUUID().replaceAll('-','');
  let setup,app;
  try{
   await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$`);
   await admin.query('CREATE DATABASE '+database);
   const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+database;url.search='';
   setup=new pg.Pool({connectionString:url.href});
   await setup.query(readFileSync('infrastructure/cloudflare/supabase-first-setup.sql','utf8'));
   await setup.query("ALTER ROLE tracker_app PASSWORD 'synthetic-isolated-role-test-password'");
   url.username='tracker_app';url.password='synthetic-isolated-role-test-password';
   app=new pg.Pool({connectionString:url.href});
   const schema=await app.query('SELECT name FROM schema_migrations');assert.equal(schema.rows.length,3);
   await app.query("INSERT INTO tracker_accounts(user_id,cognito_subject) VALUES ('synthetic-account','synthetic-subject')");
   await app.query("INSERT INTO water_intakes(id,user_id,date,amount_ml) VALUES ('synthetic-water','synthetic-account','2026-10-18',250)");
   assert.equal((await app.query('SELECT amount_ml FROM water_intakes')).rows[0].amount_ml,250);
   await assert.rejects(()=>app.query('CREATE TABLE public.should_not_exist(id text)'));
   await assert.rejects(()=>app.query("INSERT INTO schema_migrations(name,checksum) VALUES ('forged','forged')"));
   await app.query("INSERT INTO saved_meals(user_id,id,meal_json) VALUES ('synthetic-account','synthetic-meal','{}')");
   assert.equal((await app.query('SELECT id FROM saved_meals')).rows[0].id,'synthetic-meal');
   const client=await setup.connect();
   try{await client.query('SET ROLE anon');await assert.rejects(()=>client.query('SELECT * FROM public.meals'));await assert.rejects(()=>client.query('SELECT * FROM public.saved_meals'));await client.query('RESET ROLE');}finally{client.release();}
  }finally{await app?.end();await setup?.end();await admin.query('DROP DATABASE IF EXISTS '+database+' WITH (FORCE)');await admin.end();}
 });
}
