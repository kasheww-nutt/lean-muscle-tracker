export function databaseEnvironment(configuration) {
let url;
try { url = new URL(configuration.DATABASE_URL || ''); } catch { throw Error('Configure a valid PostgreSQL DATABASE_URL.'); }
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw Error('Configure a complete PostgreSQL DATABASE_URL.');
const environment = Object.fromEntries(Object.entries(configuration).filter(([key]) => !key.startsWith('PG')));
Object.assign(environment, {
  PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '5',
  PGSSLMODE: configuration.DATABASE_SSL_MODE || 'verify-full',
});
if (!['verify-full', 'disable'].includes(environment.PGSSLMODE)) throw Error('Invalid DATABASE_SSL_MODE.');
if (environment.PGSSLMODE === 'disable' && !['localhost', '127.0.0.1', '::1'].includes(environment.PGHOST)) throw Error('Remote backups require verified database TLS.');
if (configuration.DATABASE_SSL_CA_FILE) environment.PGSSLROOTCERT = configuration.DATABASE_SSL_CA_FILE;
for (const [key, value] of url.searchParams) {
  if (key === 'options') environment.PGOPTIONS = value;
  else if (key === 'application_name') environment.PGAPPNAME = value;
  else throw Error('Unsupported backup database URL option: ' + key);
}
return environment;
}
