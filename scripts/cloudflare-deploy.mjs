import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const run=(args)=>{const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(result.status!==0)process.exit(result.status||1);};
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
const base='https://tracker.kashewwnutt.tech';
const args=process.argv.slice(2),initial=args.includes('--initial');
if(!initial){
 const r=await fetch(base+'/api/ready',{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Current production is not ready. Diagnose before rolling deployment, or use --initial for first setup.');
}
// Migrations are run separately with migration credentials; runtime credentials are not privileged.
if(!process.env.DATABASE_MIGRATION_URL)throw Error('Set DATABASE_MIGRATION_URL privately before deploying.');
run(['scripts/migrate.mjs']);
async function waitFor(replica){
 const end=Date.now()+120000;
 while(Date.now()<end){
  try{const r=await fetch(base+'/api/ready?check='+randomUUID(),{signal:AbortSignal.timeout(15000)});const d=await r.json();if(r.ok&&d.replica===replica)return;}catch{}
  await new Promise(r=>setTimeout(r,3000));
 }
 throw Error('Could not verify '+replica+' after deployment. Stop rollout and inspect Workers logs.');
}
run([wrangler,'deploy','-c','infrastructure/cloudflare/wrangler.b.jsonc']);
if(!initial)await waitFor('replica-b');
run([wrangler,'deploy','-c','infrastructure/cloudflare/wrangler.a.jsonc']);
if(!initial)await waitFor('replica-a');
run([wrangler,'deploy','-c','infrastructure/cloudflare/wrangler.router.jsonc']);
await waitFor('replica-a');await waitFor('replica-b');
console.log('Cloudflare deployment passed: both replicas are ready through the public router.');
