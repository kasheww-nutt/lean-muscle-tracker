import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const skip=new Set(['node_modules','.git','dist','.wrangler','.next','.cloudflare']);
const sensitiveName=/^(?:\.dev\.vars(?:\..*)?|\.env(?:\..*)?)$/;
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{30,}/,/AKIA[0-9A-Z]{16}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/appgprj_[a-f0-9]{20,}/,new RegExp(['sweet','goby','3200'].join('-')),/[A-Za-z0-9._%+-]+@gmail\.com/i];
let count=0;
function visit(dir){for(const name of readdirSync(dir)){if(skip.has(name))continue;const path=resolve(dir,name),rel=relative(root,path);if(statSync(path).isDirectory()){visit(path);continue;}assert.ok(!sensitiveName.test(name)||name==='.env.example','Private environment file: '+rel);assert.ok(!/\.(sqlite3?|db|pem|key|p12)$/.test(name),'Private runtime file: '+rel);if(/\.(png|ico|ttf|woff2?)$/.test(name))continue;const text=readFileSync(path,'utf8');for(const pattern of patterns)assert.ok(!pattern.test(text),'Sensitive source pattern: '+rel);count++;}}
visit(root);console.log('Publication source guard passed for '+count+' text files.');
