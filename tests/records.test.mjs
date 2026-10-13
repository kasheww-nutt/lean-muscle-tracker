import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const directory=mkdtempSync(join(tmpdir(),'manual-records-'));
Object.assign(process.env,{DATABASE_DRIVER:'sqlite',DATABASE_PATH:join(directory,'records.sqlite'),PUBLIC_BASE_URL:'https://tracker.example.test',TRACKER_AUTH_MODE:'cognito',TRACKER_OWNER_ID:'synthetic-owner',TRACKER_ACCESS_CODE:'5678',TRACKER_SESSION_SECRET:'synthetic-manual-session-secret-at-least-32-characters',COGNITO_USER_POOL_ID:'ap-south-1_Synthetic',COGNITO_OWNER_SUB:'synthetic-owner-sub',OAUTH_CLIENT_ID:'synthetic-client',TRACKER_MCP_TOKEN:'synthetic-mcp-private-token-at-least-32-characters'});
let admin,schema;
if(process.env.TEST_DATABASE_URL){const {default:pg}=await import('pg');admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});schema='manual_test_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);Object.assign(process.env,{DATABASE_DRIVER:'postgres',DATABASE_URL:url.href,DATABASE_SSL_MODE:'disable',DATABASE_AUTO_MIGRATE:'1'});}
const {env}=await import('../backend/services/runtime.ts');const {accountForSubject}=await import('../backend/services/accounts.ts');const {createTrackerSessionCookie}=await import('../backend/services/access.ts');
const api=await import('../backend/api/records.ts'),mcp=await import('../backend/mcp/handler.ts'),dashboard=await import('../backend/api/dashboard.ts');
const [owner,other]=await Promise.all([accountForSubject('synthetic-owner-sub'),accountForSubject('synthetic-other-sub')]);
const [ownerCookie,otherCookie]=await Promise.all([owner,other].map(async id=>(await createTrackerSessionCookie(id)).split(';')[0]));
const origin=process.env.PUBLIC_BASE_URL,date='2026-10-13';
const request=(method,body,cookie=ownerCookie,requestOrigin=origin)=>new Request(origin+'/api/records',{method,headers:{Cookie:cookie,Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const save=(kind,data,id=randomUUID(),cookie=ownerCookie)=>api.POST(request('POST',{kind,id,data},cookie));
const get=async(cookie=ownerCookie)=>(await api.GET(new Request(origin+'/api/records?date='+date,{headers:{Cookie:cookie}}))).json();
async function tool(name,args){const response=await mcp.POST(new Request(origin+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+process.env.TRACKER_MCP_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));const rpc=await response.json();assert.equal(rpc.result.isError,undefined);return JSON.parse(rpc.result.content[0].text);}
const meal={date,name:'Synthetic manual meal',calories:100,protein:10,carbs:10,fat:2,ingredients:'Reported quantities',ingredient_details:[{name:'Synthetic ingredient',quantity:'1 portion',calories:100}],meal_type:'Lunch'};
test('Manual meals, water, weight, references and exercise sets appear through MCP; edits preserve structured data',async()=>{
 const mealId=randomUUID();assert.equal((await save('meal',meal,mealId)).status,200);
 assert.equal((await save('water',{date,amount_ml:250,note:'Measured'})).status,200);
 const weightId=randomUUID();assert.equal((await save('weight',{date,weight_kg:54,context:'Morning'},weightId)).status,200);
 assert.equal((await save('weight',{date:null,weight_kg:52,record_type:'reference',context:'Undated start'})).status,200);
 const workoutId=randomUUID();assert.equal((await save('workout',{date,session:'Upper',exercises:[{name:'Row',sets:[{reps:10,load_kg:20},{reps:8,load_kg:20}]}]},workoutId)).status,200);
 let records=await get();assert.equal(records.meals[0].source,'manual');assert.equal(records.workouts[0].volume_kg,360);assert.equal(records.weights.length,2);assert.equal(records.meals[0].user_id,undefined);
 const read=await tool('tracker_get_day',{date});assert.equal(read.meals[0].id,mealId);assert.equal(read.waterTotalMl,250);
 assert.equal((await api.PATCH(request('PATCH',{kind:'meal',id:mealId,data:{note:'Corrected note'}}))).status,200);
 records=await get();assert.deepEqual(records.meals[0].ingredient_details,meal.ingredient_details);assert.equal(records.meals[0].calories,100);
 assert.equal((await api.PATCH(request('PATCH',{kind:'workout',id:workoutId,data:{exercises:[{name:'Row',sets:[{reps:5,load_kg:20}]}]}}))).status,200);assert.equal((await get()).workouts[0].volume_kg,100);
 // MCP writes are visible and editable through the same manual API.
 const logged=await tool('tracker_log_meal',{...meal,name:'Synthetic MCP meal'});
 assert.equal((await api.PATCH(request('PATCH',{kind:'meal',id:logged.id,data:{calories:120}}))).status,200);
 assert.equal((await tool('tracker_get_day',{date})).meals.find(m=>m.id===logged.id).calories,120);
 const ref=(await get()).weights.find(w=>w.record_type==='reference');
 assert.equal((await api.PATCH(request('PATCH',{kind:'weight',id:ref.id,data:{record_type:'weigh_in'}}))).status,400);
 assert.equal((await api.PATCH(request('PATCH',{kind:'weight',id:ref.id,data:{record_type:'weigh_in',date}}))).status,200);
 assert.equal((await api.PATCH(request('PATCH',{kind:'weight',id:weightId,data:{weight_kg:55}}))).status,200);
 assert.equal((await api.DELETE(request('DELETE',{kind:'meal',id:logged.id}))).status,200);
 assert.equal((await tool('tracker_get_day',{date})).meals.some(m=>m.id===logged.id),false);
});
test('Manual API enforces session/origin/validation and stable submissions prevent duplicate saves',async()=>{
 assert.equal((await save('meal',meal,randomUUID(),'')).status,401);
 assert.equal((await api.POST(request('POST',{kind:'meal',id:randomUUID(),data:meal},ownerCookie,'https://attacker.example.test'))).status,403);
 for(const [kind,data] of [['meal',{...meal,calories:-1}],['meal',{...meal,protein:'10'}],['water',{date,amount_ml:0}],['weight',{date,weight_kg:5}],['workout',{date,session:'Upper'}],['meal',{...meal,date:'2026-02-30'}],['meal',{...meal,user_id:other}],['meal',{...meal,is_test:'true'}],['workout',{date,session:'Upper',exercises:[{name:'Row',sets:[{reps:2.5,load_kg:20}]}]}]])assert.equal((await save(kind,data)).status,400);
 const id=randomUUID();assert.equal((await save('meal',{...meal,name:'Retry-safe'},id)).status,200);assert.equal((await save('meal',{...meal,name:'Retry-safe'},id)).status,200);
 assert.equal((await get()).meals.filter(m=>m.id===id).length,1);
 assert.equal((await save('meal',{...meal,name:'Changed retry'},id)).status,409);
 const fictional=await save('meal',{...meal,name:'Fictional',calories:9999,is_test:true});assert.equal(fictional.status,200);
 const data=await (await dashboard.GET(new Request(origin+'/api/dashboard?date='+date,{headers:{Cookie:ownerCookie}}))).json();assert.ok(data.totals.calories<9999);
 assert.equal((await api.POST(new Request(origin+'/api/records',{method:'POST',headers:{Cookie:ownerCookie,Origin:origin,'Content-Type':'application/json'},body:'{'}))).status,400);
});
test('A second account cannot read, update, delete or reuse another account’s submission IDs',async()=>{
 const before=await get(otherCookie);assert.equal(before.meals.length,0);assert.equal(before.water.length,0);assert.equal(before.weights.length,0);assert.equal(before.workouts.length,0);
 const mine=(await get()).meals[0];
 assert.equal((await api.PATCH(request('PATCH',{kind:'meal',id:mine.id,data:{name:'Stolen'}},otherCookie))).status,404);
 assert.equal((await api.DELETE(request('DELETE',{kind:'meal',id:mine.id},otherCookie))).status,404);
 assert.equal((await save('meal',meal,mine.id,otherCookie)).status,409);
 const data={date,amount_ml:100};const id=randomUUID();assert.equal((await save('water',data,id,otherCookie)).status,200);
 assert.equal((await get()).water.some(w=>w.id===id),false);
 assert.equal((await api.DELETE(request('DELETE',{kind:'water',id},otherCookie))).status,200);
});
test.after(async()=>{await env.DB.close?.();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}rmSync(directory,{recursive:true,force:true});});
