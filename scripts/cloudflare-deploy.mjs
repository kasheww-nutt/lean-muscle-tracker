import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const run=(args)=>{const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(result.status!==0)process.exit(result.status||1);};
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
const base='https://tracker.kashewwnutt.tech';
const args=process.argv.slice(2),initial=args.includes('--initial');
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
async function readyProbe(){
 const r=await fetch(base+'/api/ready?check='+randomUUID(),{signal:AbortSignal.timeout(15000)});
 let d=null;try{d=await r.json();}catch{}
 return {ok:r.ok,status:r.status,replica:d?.replica??'unknown'};
}
if(!initial){
 let ready=false;
 for(let attempt=0;attempt<6;attempt++){
  try{const probe=await readyProbe();if(probe.ok){ready=true;break;}}catch{}
  await wait(3000);
 }
 if(!ready)console.warn('Current production did not report ready before rollout. Continuing to recover via deployment.');
}
// Migrations are run separately with migration credentials; runtime credentials are not privileged.
if(!process.env.DATABASE_MIGRATION_URL)throw Error('Set DATABASE_MIGRATION_URL privately before deploying.');
run(['scripts/migrate.mjs']);
run(['scripts/cloudflare-database-check.mjs']);
async function waitFor(replica){
 const end=Date.now()+300000;
 let last='no response';
 while(Date.now()<end){
  try{const probe=await readyProbe();if(probe.ok&&probe.replica===replica)return;last='status '+probe.status+' from '+probe.replica;}catch(error){last=error instanceof Error?error.message:String(error);}
  await wait(3000);
 }
 throw Error('Could not verify '+replica+' after deployment (last probe: '+last+'). Stop rollout and inspect Workers logs.');
}
run([wrangler,'deploy','-c','infrastructure/cloudflare/wrangler.b.jsonc']);
if(!initial)await waitFor('replica-b');
run([wrangler,'deploy','-c','infrastructure/cloudflare/wrangler.a.jsonc']);
if(!initial)await waitFor('replica-a');
run([wrangler,'deploy','-c','infrastructure/cloudflare/wrangler.router.jsonc']);
await waitFor('replica-a');await waitFor('replica-b');
console.log('Cloudflare deployment passed: both replicas are ready through the public router.');
