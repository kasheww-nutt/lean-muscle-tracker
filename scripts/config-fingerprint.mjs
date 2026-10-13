// Shared configuration check used by the two-instance deployment.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const keys=['TRACKER_AUTH_MODE','DATABASE_URL','DATABASE_SSL_MODE','TRACKER_OWNER_ID','TRACKER_ACCESS_CODE','TRACKER_SESSION_SECRET','PUBLIC_BASE_URL','TRACKER_MCP_TOKEN','OAUTH_CLIENT_ID','OAUTH_CLIENT_SECRET','OAUTH_REDIRECT_URIS','COGNITO_USER_POOL_ID','COGNITO_CLIENT_ID','COGNITO_CLIENT_SECRET','COGNITO_DOMAIN','COGNITO_OWNER_SUB'];
for(const key of ['DATABASE_URL','TRACKER_OWNER_ID','TRACKER_ACCESS_CODE','TRACKER_SESSION_SECRET','PUBLIC_BASE_URL'])if(!process.env[key]||process.env[key].includes('replace-'))throw Error('Incomplete shared configuration.');
if(process.env.TRACKER_SESSION_SECRET.length<32)throw Error('Configure a strong shared session secret.');
const authMode=process.env.TRACKER_AUTH_MODE||'pin';
if(!['pin','cognito'].includes(authMode))throw Error('Invalid TRACKER_AUTH_MODE.');
if(authMode==='cognito'){
 for(const key of ['COGNITO_USER_POOL_ID','COGNITO_CLIENT_ID','COGNITO_DOMAIN','COGNITO_OWNER_SUB'])if(!process.env[key]||process.env[key].includes('replace-'))throw Error('Incomplete Cognito account configuration.');
 const domain=new URL(process.env.COGNITO_DOMAIN);
 if(domain.protocol!=='https:'||domain.href!==domain.origin+'/')throw Error('Invalid Cognito domain.');
}
const ca=process.env.DATABASE_SSL_CA_FILE?readFileSync(process.env.DATABASE_SSL_CA_FILE,'utf8'):'';
// Overall digest includes a high-entropy session secret; individual secret hashes are never printed.
const digest=createHash('sha256').update(JSON.stringify(keys.map(k=>[k,process.env[k]||'']))).update(ca).digest('hex');
console.log('TRACKER_SHARED_CONFIG='+digest);
