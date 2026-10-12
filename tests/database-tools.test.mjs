import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseEnvironment } from '../infrastructure/postgres/connection-env.mjs';

test('Backup connection environment decodes credentials and IPv6 without putting credentials in arguments', () => {
  const env = databaseEnvironment({DATABASE_URL:'postgresql://owner%40name:p%3Aa%40s%25s@[::1]:5433/tracker%20db?options=-c%20search_path%3Dtracker', DATABASE_SSL_MODE:'disable', PGHOSTADDR:'forged-host', PGPASSWORD:'old-secret', PGSERVICE:'wrong-service', PATH:'/bin'});
  assert.equal(env.PGHOST,'::1'); assert.equal(env.PGPORT,'5433');
  assert.equal(env.PGUSER,'owner@name'); assert.equal(env.PGPASSWORD,'p:a@s%s');
  assert.equal(env.PGDATABASE,'tracker db'); assert.equal(env.PGOPTIONS,'-c search_path=tracker');
  assert.equal(env.PGHOSTADDR,undefined); assert.equal(env.PGSERVICE,undefined); assert.equal(env.PATH,'/bin');
});
test('Backup requires verified TLS for remote hosts and rejects ambiguous URL SSL options', () => {
  const base={DATABASE_URL:'postgresql://owner:synthetic-password@db.example.test/tracker',DATABASE_SSL_CA_FILE:'/run/tracker-db-ca.pem'};
  const env=databaseEnvironment(base); assert.equal(env.PGSSLMODE,'verify-full'); assert.equal(env.PGSSLROOTCERT,base.DATABASE_SSL_CA_FILE);
  assert.throws(()=>databaseEnvironment({...base,DATABASE_SSL_MODE:'disable'}),/verified/);
  assert.throws(()=>databaseEnvironment({...base,DATABASE_URL:base.DATABASE_URL+'?sslmode=disable'}),/Unsupported/);
  assert.throws(()=>databaseEnvironment({DATABASE_URL:'invalid-sensitive-value'}),/valid PostgreSQL/);
});
