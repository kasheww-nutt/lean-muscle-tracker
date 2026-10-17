import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=await import(require.resolve('miniflare',{paths:[dirname(require.resolve('wrangler/package.json'))]}));
const directory=mkdtempSync(join(tmpdir(),'tracker-workerd-')),bundle=join(directory,'worker.upload');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outfile',bundle,'-c','infrastructure/cloudflare/wrangler.a.jsonc'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
const raw=readFileSync(bundle);
// Wrangler's outfile is the upload multipart payload, not a JavaScript module.
const boundary=raw.subarray(0,raw.indexOf('\r\n')).toString().slice(2);
const form=await new Response(raw,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData();
const code=await form.get('backend.js').text();
const vars=JSON.parse(readFileSync('infrastructure/cloudflare/wrangler.a.jsonc','utf8')).vars;
const mf=new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:'/worker.mjs',contents:code}],modulesRoot:'/',compatibilityDate:'2026-10-17',compatibilityFlags:['nodejs_compat'],bindings:{...vars,TRACKER_SESSION_SECRET:'synthetic-workers-runtime-session-secret-at-least-32-characters'}}));
try{
 const base=vars.PUBLIC_BASE_URL;
 const health=await mf.dispatchFetch(base+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).replica,'replica-a');
 const metadata=await mf.dispatchFetch(base+'/.well-known/oauth-authorization-server');assert.equal(metadata.status,200);assert.equal((await metadata.json()).token_endpoint,base+'/oauth/token');
 const login=await mf.dispatchFetch(base+'/sso/login');assert.equal(login.status,200);assert.equal(login.headers.get('referrer-policy'),'same-origin');assert.match(await login.text(),/name="csrf"/);
 const mcp=await mf.dispatchFetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})});assert.equal(mcp.status,401);assert.match(mcp.headers.get('www-authenticate'),/resource_metadata/);
 console.log('Actual Workers runtime passed: replica health, OAuth discovery, signed login page, protected MCP challenge. No real email was sent.');
}finally{await mf.dispose();rmSync(directory,{recursive:true,force:true});}
