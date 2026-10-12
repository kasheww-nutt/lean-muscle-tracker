import { token } from '../../../../backend/api/oauth';
export function POST(request: Request) { return token(request); }
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
