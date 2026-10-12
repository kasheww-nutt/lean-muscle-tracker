import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const sqlite=new DatabaseSync(':memory:');
for(const file of readdirSync(new URL('../database/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
const DB={prepare(sql){return{bind(...args){return{async all(){return{results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}};}};
globalThis.mockEnv={DB,TRACKER_OWNER_ID:'owner',TRACKER_SESSION_SECRET:'test-secret-for-local-tests-only',TRACKER_ACCESS_CODE:'5678'};
registerHooks({resolve(specifier,context,next){if(specifier.endsWith('/runtime'))return next('data:text/javascript,export const env=globalThis.mockEnv',context);if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.[a-z]+$/.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return next(url.href,context);}return next(specifier,context);}});
const access=await import('../backend/services/access.ts');
const history=await import('../backend/api/history.ts');
const widget=await import('../backend/api/widget.ts');
const {localDate,shiftDate}=await import('../backend/services/tracker.ts');
const today=localDate();
const cookie=(await access.createTrackerSessionCookie()).split(';')[0];
const request=(path,method='GET',authenticated=false)=>new Request('https://tracker.test'+path,{method,headers:{Origin:'https://tracker.test',...(authenticated?{Cookie:cookie}:{})}});
for(let i=0;i<32;i++){sqlite.prepare('INSERT INTO meals (id,user_id,date,name,calories,protein,carbs,fat,ingredient_details) VALUES (?,?,?,?,?,?,?,?,?)').run('meal-'+i,'owner',shiftDate(today,-i),i===0?'Poha + cucumber':'Old meal',i===0?150:100,3,25,4,'[{"name":"Poha","quantity":"1 small plate"}]');}
sqlite.prepare('INSERT INTO meals (id,user_id,date,name,calories,protein,carbs,fat,is_test) VALUES (?,?,?,?,?,?,?,?,?)').run('fake','owner',today,'Fictional snack',9999,9999,1,1,1);
sqlite.prepare('INSERT INTO meals (id,user_id,date,name,calories,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?)').run('other','other-user',today,'Secret meal',8000,50,1,1);
sqlite.prepare('INSERT INTO body_weights (id,user_id,weight_kg,record_type) VALUES (?,?,?,?)').run('reference','owner',60.0,'reference');
test('History requires PIN access, excludes tests/other owners, paginates without losing dates and searches all records',async()=>{
 assert.equal((await history.GET(request('/api/history'))).status,401);
 const r=await history.GET(request('/api/history','GET',true));assert.equal(r.status,200);const b=await r.json();assert.equal(b.days.length,30);assert.equal(b.meals.length,30);assert.ok(b.next);assert.equal(b.meals[0].ingredient_details[0].quantity,'1 small plate');
 const older=await (await history.GET(request('/api/history?before='+b.next,'GET',true))).json();assert.equal(older.days.length,2);assert.equal(new Set([...b.days,...older.days]).size,32);
 const match=await (await history.GET(request('/api/history?q=cucumber','GET',true))).json();assert.equal(match.days.length,1);
 const hidden=await (await history.GET(request('/api/history?q=Secret','GET',true))).json();assert.equal(hidden.days.length,0);
 assert.equal((await history.GET(request('/api/history?before=2026-02-30','GET',true))).status,400);
 assert.equal((await history.GET(request('/api/history?type=unknown','GET',true))).status,400);
});
test('Widget tokens are scoped, hashed, replaceable, revocable and expire; missing readings stay unknown',async()=>{
 assert.equal((await widget.GET(request('/api/widget'))).status,401);assert.equal((await widget.POST(request('/api/widget','POST'))).status,401);
 const created=await widget.POST(request('/api/widget','POST',true));assert.equal(created.status,200);const {token}=await created.json();assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(sqlite.prepare('SELECT token_hash FROM widget_tokens').get().token_hash,token);
 const get=()=>widget.GET(request('/api/widget?key='+token));const initial=await get();assert.equal(initial.status,200);const value=await initial.json();assert.equal(value.calories,150);assert.equal(value.waterMl,null);assert.equal(value.weight,null);assert.equal(value.nutrition_text.includes('150 kcal'),true);assert.equal(value.water_text.includes('No intake logged'),true);
 assert.equal(await access.hasTrackerAccess(request('/api/dashboard?key='+token)),false);
 const replacement=await (await widget.POST(request('/api/widget','POST',true))).json();assert.equal((await get()).status,401);assert.equal((await widget.GET(request('/api/widget?key='+replacement.token))).status,200);
 sqlite.prepare('UPDATE widget_tokens SET expires_at=0').run();assert.equal((await widget.GET(request('/api/widget?key='+replacement.token))).status,401);
 await widget.POST(request('/api/widget','POST',true));await widget.DELETE(request('/api/widget','DELETE',true));assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM widget_tokens').get().n,0);
});

const mcp=await import('../backend/mcp/handler.ts');
test('Standalone MCP rejects forged identity and binds authenticated writes to the configured owner',async()=>{
 globalThis.mockEnv.TRACKER_MCP_TOKEN='synthetic-test-mcp-token-at-least-32-characters';
 const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'tracker_log_meal',arguments:{date:today,name:'Synthetic integration meal',calories:100,protein:5,carbs:10,fat:4}}};
 const call=headers=>mcp.POST(new Request('https://tracker.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 const blocked=await (await call({'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'})).json();
 assert.equal(blocked.error,'MCP authentication required.');
 const saved=await (await call({Authorization:'Bearer '+globalThis.mockEnv.TRACKER_MCP_TOKEN})).json();
 const record=JSON.parse(saved.result.content[0].text);assert.equal(record.saved,true);
 assert.equal(sqlite.prepare('SELECT user_id FROM meals WHERE id=?').get(record.id).user_id,'owner');
 const wrong=await (await call({Authorization:'Bearer invalid-token'})).json();assert.equal(wrong.error,'MCP authentication required.');
});
