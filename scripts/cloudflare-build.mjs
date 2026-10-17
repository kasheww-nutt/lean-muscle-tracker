import {cpSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),target=resolve(root,'.cloudflare/frontend');
rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
// Preserve the exact UI source; remove server-only routes only from this generated copy.
cpSync(resolve(root,'frontend'),target,{recursive:true,filter:path=>!/(?:^|\/)(?:\.next|out|node_modules)(?:\/|$)/.test(path)});
for(const name of ['api','oauth','sso','auth','.well-known','mcp'])rmSync(resolve(target,'app',name),{recursive:true,force:true});
// Generated copy is one directory deeper than the source frontend.
for(const name of ['tsconfig.json','next.config.ts','next-env.d.ts'])rmSync(resolve(target,name),{force:true});
writeFileSync(resolve(target,'next.config.mjs'),"export default {output:'export',images:{unoptimized:true},experimental:{cpus:2},typescript:{ignoreBuildErrors:true}};\n");
// Frontend's lib file re-exports shared, pure tracker calculations.
const lib=resolve(target,'lib/tracker.ts');
writeFileSync(lib,readFileSync(lib,'utf8').replaceAll('../../backend/','../../../backend/'));
const result=spawnSync(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build',target,'--webpack'],{cwd:root,stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
if(result.status!==0)process.exit(result.status||1);
const directory=resolve(root,'database/postgres/migrations');
const migrations=readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort().map(name=>({name,checksum:createHash('sha256').update(readFileSync(resolve(directory,name),'utf8')).digest('hex')}));
writeFileSync(resolve(root,'infrastructure/cloudflare/migrations.generated.ts'),'// Generated from PostgreSQL migrations. Run npm run build:cloudflare.\nexport const expectedMigrations = '+JSON.stringify(migrations,null,2)+' as const;\n');
console.log('Static dashboard and Workers migration manifest built.');
