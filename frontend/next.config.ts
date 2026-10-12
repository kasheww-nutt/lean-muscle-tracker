import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = { outputFileTracingRoot: path.resolve(process.cwd()), serverExternalPackages: ["node:sqlite", "pg"], experimental: { cpus: 2 }, async headers() { return [{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"no-referrer"},{key:"Strict-Transport-Security",value:"max-age=31536000"}]}]; } };
export default config;
