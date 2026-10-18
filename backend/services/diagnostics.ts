// Log only fixed categories and recognized codes, never raw errors or connection URLs.
export function databaseFailure(error: unknown) {
  const e = error && typeof error === 'object' ? error as {code?:unknown;message?:unknown} : {};
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  const known = new Set(['ERR_OPTION_NOT_IMPLEMENTED','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND']);
  const code = typeof e.code === 'string' && (known.has(e.code) || /^[0-9A-Z]{5}$/.test(e.code)) ? e.code : 'UNKNOWN';
  let category = 'database-or-runtime';
  if (/certificate|tls|ssl|secure transport/.test(message) || /CERT|TLS/.test(code)) category='database-tls';
  if (/not implemented|not supported|unsupported/.test(message)) category='runtime-unsupported-option';
  if (/password authentication|tenant or user|authentication failed/.test(message) || code==='28P01' || code==='28000') category='database-authentication';
  if (/permission denied/.test(message) || code==='42501') category='database-permission';
  if (/schema is outdated|does not exist|applied migration/.test(message) || code==='42P01') category='database-schema';
  if (/timeout|timed out/.test(message) || code==='ETIMEDOUT') category='database-timeout';
  if (/configuration missing|database_url/.test(message)) category='backend-configuration';
  return {category,code};
}

// Readiness queries contain no user records. Only their redacted message is logged.
export function readinessFailure(error: unknown) {
  const raw = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'No error message available';
  let detail=raw;
  const privateValues:string[]=[];
  for(const [key,value] of Object.entries(process.env)) {
    if(value && /SECRET|TOKEN|PASSWORD|DATABASE_URL|MIGRATION_URL|DATABASE_SSL_CA/.test(key)) privateValues.push(value);
  }
  for(const key of ['DATABASE_URL','DATABASE_MIGRATION_URL']) {
    try {
      const url=new URL(process.env[key]||'');
      for(const value of [url.username,url.password])if(value)privateValues.push(value,decodeURIComponent(value));
    }catch{}
  }
  for(const value of privateValues.sort((a,b)=>b.length-a.length))if(value)detail=detail.split(value).join('[REDACTED]');
  detail=detail.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[REDACTED DATABASE URL]').replace(/[\r\n\t]+/g,' ').slice(0,400);
  return {...databaseFailure(error),detail};
}
