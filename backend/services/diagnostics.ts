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
