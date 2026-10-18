import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {configureHyperdrive,hyperdriveOrigin} from '../scripts/cloudflare-hyperdrive-setup.mjs';
const ca=rootCertificates.find(value=>{const c=new X509Certificate(value);return c.ca&&Date.parse(c.validTo)>Date.now();});
const settings={accountId:'a'.repeat(32),token:'synthetic-cloudflare-token',connectionString:'postgresql://tracker_app.project:synthetic%40password@pooler.example.test:5432/postgres',ca};
test('Hyperdrive setup verifies the origin CA and hostname, disables caching and binds restricted credentials',async()=>{
 const calls=[];
 const id=await configureHyperdrive({...settings,request:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):undefined;
  calls.push({url,options,body});
  let result=[];
  if(options.method==='POST'&&url.endsWith('/mtls_certificates'))result={id:'trusted-ca',ca:true};
  if(options.method==='POST'&&url.endsWith('/hyperdrive/configs'))result={id:'b'.repeat(32)};
  return Response.json({success:true,result});
 }});
 assert.equal(id,'b'.repeat(32));
 const body=calls.at(-1).body;
 assert.deepEqual(body.mtls,{ca_certificate_id:'trusted-ca',sslmode:'verify-full'});
 assert.deepEqual(body.caching,{disabled:true});
 assert.equal(body.origin_connection_limit,5);
 assert.equal(body.origin.user,'tracker_app.project');
 assert.equal(body.origin.password,'synthetic@password');
 assert.equal(calls.filter(c=>c.options.method==='POST').length,2);
});
test('Hyperdrive reuses a matching CA and updates the existing configuration on redeploy',async()=>{
 const calls=[];
 await configureHyperdrive({...settings,request:async(url,options)=>{
  calls.push({url,options});
  let result=[];
  if(url.includes('/mtls_certificates')) {
   const {createHash}=await import('node:crypto');
   const name='lean-tracker-ca-'+createHash('sha256').update(new X509Certificate(ca).raw).digest('hex').slice(0,16);
   result=[{name,ca:true,id:'existing-ca'}];
  }else if(options.method==='GET')result=[{name:'lean-tracker-db',id:'b'.repeat(32)}];
  else result={id:'b'.repeat(32)};
  return Response.json({success:true,result});
 }});
 assert.equal(calls.at(-1).options.method,'PUT');
 assert.ok(calls.every(c=>c.options.method!=='POST'));
});
test('Hyperdrive permission failures do not expose API response credentials',async()=>{
 await assert.rejects(configureHyperdrive({...settings,request:async()=>Response.json({success:false,errors:[{code:10000,message:settings.connectionString}]},{status:403})}),error=>{
  assert.match(error.message,/HTTP 403/);
  assert.ok(!error.message.includes('synthetic%40password'));
  assert.match(error.message,/Hyperdrive Edit/);
  return true;
 });
 assert.throws(()=>hyperdriveOrigin(settings.connectionString+'?sslmode=disable'),/no URL options/);
});
