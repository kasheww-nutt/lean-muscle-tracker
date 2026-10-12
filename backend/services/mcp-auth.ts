import { env } from './runtime';
import { safeCodeEqual } from './access';
import { hash } from './security';
export async function authenticateMcp(request: Request): Promise<{userId: string} | null> {
  const expected = env.TRACKER_MCP_TOKEN;
  const owner = env.TRACKER_OWNER_ID;
  const value = request.headers.get('authorization') || '';
  if (!owner || !value.startsWith('Bearer ')) return null;
  const token = value.slice(7);
  if (expected && expected.length >= 32 && safeCodeEqual(token,expected)) return {userId:owner};
  if (!process.env.PUBLIC_BASE_URL || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT client_id FROM oauth_tokens WHERE token_hash=? AND kind='access' AND resource=? AND expires_at>?").bind(hash(token),`${new URL(process.env.PUBLIC_BASE_URL).origin}/mcp`,Date.now()).first<{client_id:string}>();
  return row && row.client_id === process.env.OAUTH_CLIENT_ID ? {userId:owner} : null;
}
