import test from 'node:test';
import assert from 'node:assert/strict';
import {rollout,readinessProbe,waitFor} from '../scripts/cloudflare-deploy.mjs';
test('Recovery verifies B before updating A and stops without replacing A when B fails',async()=>{
 const actions=[];
 await assert.rejects(rollout(name=>actions.push('deploy-'+name),async name=>{actions.push('ready-'+name);throw Error('database unavailable');}),/database unavailable/);
 assert.deepEqual(actions,['deploy-router','deploy-b','ready-replica-b']);
 actions.length=0;
 await rollout(name=>actions.push('deploy-'+name),async name=>actions.push('ready-'+name));
 assert.deepEqual(actions,['deploy-router','deploy-b','ready-replica-b','deploy-a','ready-replica-a','ready-replica-b']);
});
test('Readiness probes target one replica, reject wrong replicas and tolerate non-JSON responses',async()=>{
 const probe=value=>async url=>{assert.equal(url.searchParams.get('replica'),'replica-a');return Response.json(value);};
 assert.equal((await readinessProbe('replica-a',probe({status:'ok',replica:'replica-a'}))).ok,true);
 assert.equal((await readinessProbe('replica-a',probe({status:'ok',replica:'replica-b'}))).ok,false);
 assert.equal((await readinessProbe('replica-a',async()=>new Response('Unavailable',{status:503}))).replica,'non-json');
 let count=0,time=0;
 await waitFor('replica-a',{now:()=>time,timeout:20,pause:async()=>{time+=10;},probe:async()=>({ok:++count===2,status:200,replica:'replica-a'})});
 assert.equal(count,2);
 await assert.rejects(waitFor('replica-a',{timeout:0,probe:async()=>({ok:false,status:503,replica:'missing'})}),/HTTP 503/);
});
