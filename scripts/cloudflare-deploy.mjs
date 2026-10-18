import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const base='https://tracker.kashewwnutt.tech';

export async function readinessProbe(replica,request=fetch) {
 try {
  const url=new URL('/api/ready',base);url.searchParams.set('replica',replica);url.searchParams.set('check',randomUUID());
  const response=await request(url,{signal:AbortSignal.timeout(15000),redirect:'manual',cache:'no-store'});
  let value;try{value=await response.json();}catch{return {ok:false,status:response.status,replica:'non-json'};}
  const actual=['replica-a','replica-b'].includes(value?.replica)?value.replica:'missing';
  return {ok:response.ok&&value?.status==='ok'&&actual===replica,status:response.status,replica:actual};
 }catch{return {ok:false,status:0,replica:'connection-failed'};}
}

export async function waitFor(replica,{probe=readinessProbe,timeout=120000,pause=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}) {
 const end=now()+timeout;let last;
 do {
  last=await probe(replica);if(last.ok)return;
  if(now()>=end)break;
  await pause(3000);
 }while(now()<end);
 throw Error('Readiness failed for '+replica+' (last HTTP '+last?.status+', replica '+last?.replica+'). Rollout stopped; the next replica was not updated.');
}

export async function rollout(deploy,ready=waitFor) {
 // The router's read-only targeting must exist before individual replica checks.
 await deploy('router');
 await deploy('b');await ready('replica-b');
 await deploy('a');await ready('replica-a');
 await ready('replica-b');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const run=args=>{const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(result.status!==0)throw Error('Deployment command failed; rollout stopped.');};
 try {
  if(!process.env.DATABASE_MIGRATION_URL)throw Error('Set DATABASE_MIGRATION_URL privately before deploying.');
  run(['scripts/migrate.mjs']);run(['scripts/cloudflare-database-check.mjs']);
  const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
  await rollout(replica=>run([wrangler,'deploy','-c','infrastructure/cloudflare/wrangler.'+replica+'.jsonc']));
  console.log('Cloudflare deployment passed: both replicas are database-ready through the public router.');
 }catch(error){console.error(error instanceof Error?error.message:'Deployment failed.');process.exitCode=1;}
}
