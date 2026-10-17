import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const directory=resolve('database/postgres/migrations');
let sql="-- FIRST SETUP ONLY: empty Supabase tracker database. Run in Supabase SQL Editor.\nBEGIN;\nSELECT pg_advisory_xact_lock(673017543);\nCREATE TABLE public.schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);\n";
for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
 const text=readFileSync(resolve(directory,name),'utf8');
 sql+=text+"\nINSERT INTO public.schema_migrations(name,checksum) VALUES ('"+name+"','"+createHash('sha256').update(text).digest('hex')+"');\n";
}
sql+='COMMIT;\n';
sql+=readFileSync('infrastructure/cloudflare/database-security.sql','utf8');
writeFileSync('infrastructure/cloudflare/supabase-first-setup.sql',sql);
console.log('Created infrastructure/cloudflare/supabase-first-setup.sql for an EMPTY database.');
