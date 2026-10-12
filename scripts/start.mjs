import { spawn } from 'node:child_process';
import { postgresConfig } from '../backend/services/postgres.ts';
for (const key of ['TRACKER_OWNER_ID','TRACKER_ACCESS_CODE','TRACKER_SESSION_SECRET','TRACKER_MCP_TOKEN','OAUTH_CLIENT_ID','OAUTH_CLIENT_SECRET','OAUTH_REDIRECT_URIS','COGNITO_USER_POOL_ID','COGNITO_CLIENT_ID','COGNITO_CLIENT_SECRET','COGNITO_DOMAIN','COGNITO_OWNER_SUB']) {
  if (process.env[key]?.includes('replace-')) throw Error(`${key} contains an unconfigured placeholder.`);
}
for (const key of ['TRACKER_OWNER_ID','TRACKER_ACCESS_CODE','TRACKER_SESSION_SECRET','PUBLIC_BASE_URL']) {
  if (!process.env[key] || process.env[key].startsWith('replace-')) throw Error(`${key} must be configured.`);
}
if (!/^(?:[0-9]{4}|[a-f0-9]{32})$/.test(process.env.TRACKER_ACCESS_CODE)) throw Error('Access code must be four digits or 32 lowercase hex characters.');
if (process.env.TRACKER_SESSION_SECRET.length < 32) throw Error('Session secret must have at least 32 characters.');
const base = new URL(process.env.PUBLIC_BASE_URL);
if (base.protocol !== 'https:' || base.href !== base.origin + '/') throw Error('PUBLIC_BASE_URL must be an HTTPS origin without a path.');
if (process.env.TRACKER_MCP_TOKEN && process.env.TRACKER_MCP_TOKEN.length < 32) throw Error('MCP token is too short.');
if (process.env.OAUTH_CLIENT_SECRET && process.env.OAUTH_CLIENT_SECRET.length < 32) throw Error('OAuth client secret must have at least 32 characters.');
if ((process.env.OAUTH_CLIENT_SECRET || process.env.OAUTH_REDIRECT_URIS) && !process.env.OAUTH_CLIENT_ID) throw Error('OAuth client ID is required when configuring OAuth.');
if (process.env.OAUTH_CLIENT_ID) {
  const redirects = (process.env.OAUTH_REDIRECT_URIS || '').split(',').filter(Boolean);
  if (!redirects.length || redirects.some(r => new URL(r).protocol !== 'https:' || new URL(r).hash)) throw Error('Configure exact HTTPS OAuth redirect URIs.');
}
const cognitoKeys = ['COGNITO_USER_POOL_ID','COGNITO_CLIENT_ID','COGNITO_DOMAIN','COGNITO_OWNER_SUB'];
if (cognitoKeys.some(key => process.env[key]) || process.env.COGNITO_CLIENT_SECRET) {
  if (cognitoKeys.some(key => !process.env[key])) throw Error('Complete the Cognito pool, client, domain and owner configuration.');
  const domain = new URL(process.env.COGNITO_DOMAIN);
  if (domain.protocol !== 'https:' || domain.href !== domain.origin + '/') throw Error('COGNITO_DOMAIN must be an HTTPS origin.');
}
if (process.env.DATABASE_DRIVER !== 'sqlite') {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('replace-')) throw Error('Configure the shared DATABASE_URL.');
  postgresConfig(process.env.DATABASE_URL);
}
if (process.env.REPLICA_ID && !/^[A-Za-z0-9_-]{1,64}$/.test(process.env.REPLICA_ID)) throw Error('Invalid REPLICA_ID.');
const port = process.env.PORT || '5173';
if (!/^\d+$/.test(port) || Number(port)<1024 || Number(port)>65535) throw Error('Invalid PORT.');
const child = spawn(process.execPath,['node_modules/next/dist/bin/next','start','frontend','--hostname','0.0.0.0','--port',port],{stdio:'inherit'});
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code ?? 1));
