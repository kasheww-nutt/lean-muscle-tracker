import { env } from '../../../../backend/services/runtime';
const replica = () => process.env.REPLICA_ID || 'local';
export async function GET() {
  const headers = {'Cache-Control':'no-store', 'X-Tracker-Replica': replica()};
  try {
    await env.DB.prepare('SELECT 1').bind().first();
    return Response.json({status:'ok', replica:replica()},{headers});
  } catch { return Response.json({status:'unavailable',replica:replica()},{status:503,headers}); }
}
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
