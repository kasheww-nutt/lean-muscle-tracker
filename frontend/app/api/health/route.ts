import { env } from '../../../../backend/services/runtime';
export async function GET() { try { await env.DB.prepare('SELECT 1').bind().first(); return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}}); } catch { return Response.json({status:'unavailable'},{status:503}); } }
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
