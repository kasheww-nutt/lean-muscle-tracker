// Post-deploy integration uses one synthetic account and one bounded AI call.
// Never sends a real person's food logs or prints credentials/provider prompts.
import pg from 'pg';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {postgresConfig} from '../backend/services/postgres.ts';
const base='https://tracker.kashewwnutt.tech',user='deployment_coach_'+randomUUID();
let pool;
try{
 if(!process.env.DATABASE_MIGRATION_URL||!process.env.TRACKER_SESSION_SECRET)throw Error('Deployment verification credentials missing.');
 pool=new pg.Pool(postgresConfig(process.env.DATABASE_MIGRATION_URL));
 await pool.query('INSERT INTO tracker_accounts(user_id,cognito_subject) VALUES ($1,$2)',[user,'synthetic:'+user]);
 const payload='v2.'+Buffer.from(JSON.stringify({userId:user,expiry:Date.now()+120000})).toString('base64url');
 const cookie='lean_tracker_access='+payload+'.'+createHmac('sha256',process.env.TRACKER_SESSION_SECRET).update(payload).digest('hex');
 async function request(path,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(35000),cache:'no-store'});
  if(!response.ok)throw Error('Coach production check failed (HTTP '+response.status+'). Inspect Worker configuration and AI allowance.');
  return response.json();
 }
 const context=await request('/api/coach');
 if(!context.aiAvailable||context.mealCount!==0||context.plans.length!==0||!context.planning.options.length)throw Error('Coach context or AI binding is unavailable after deployment.');
 const response=await request('/api/coach',{action:'ask',id:randomUUID(),date:context.date,question:'In one sentence, explain that an empty food log does not prove I ate nothing. Do not propose a meal or change anything.',consent:true});
 if(typeof response.answer!=='string'||response.answer.trim().length<5||response.source!=='Cloudflare Workers AI')throw Error('AI production response was not usable.');
 console.log('Meal planner and Cloudflare AI production check passed using a synthetic empty account. No real user records accessed.');
}catch(error){console.error(error instanceof Error&&/Coach |credentials|AI production/.test(error.message)?error.message:'Coach production check failed. Inspect configuration privately.');process.exitCode=1;}
finally{if(pool){try{await pool.query('DELETE FROM coach_answers WHERE user_id=$1',[user]);await pool.query('DELETE FROM auth_attempts WHERE key=$1',['coach-user:'+createHash('sha256').update(user).digest('hex')+':'+new Date().toISOString().slice(0,10)]);await pool.query('DELETE FROM tracker_accounts WHERE user_id=$1',[user]);}catch{console.error('Synthetic coach verification cleanup failed. Inspect deployment logs privately.');process.exitCode=1;}finally{await pool.end();}}}
