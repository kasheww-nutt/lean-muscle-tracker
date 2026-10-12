export { POST } from '../../../backend/mcp/handler';

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() { return new Response(null, {status:405,headers:{Allow:"POST"}}); }
