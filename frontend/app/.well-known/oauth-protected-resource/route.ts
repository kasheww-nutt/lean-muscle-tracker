import { metadata } from '../../../../backend/api/oauth';
export function GET() { return metadata(true); }
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
