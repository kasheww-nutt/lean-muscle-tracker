# Setup

Use Node.js 24 and run all commands from the repository root. `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, then `node scripts/smoke.mjs` verify the local production backend.

Docker uses the root `.env` (or TRACKER_ENV_FILE override), not `frontend/.dev.vars`. Copy `.env.example`, replace placeholders, set a four-digit PIN for the original screen, and generate distinct random secrets. Production startup requires an HTTPS PUBLIC_BASE_URL and rejects placeholder values, short session/OAuth secrets, incomplete identity configuration and malformed configuration. Optional MCP/OAuth/SSO values stay empty until configured; populated placeholders are rejected.

For local development load the configured variables into the process, then run `npm run dev`. Browser access needs HTTPS because session cookies are Secure. A local HTTP browser session is not a substitute for the production HTTPS test; the included smoke check supplies the signed cookie directly over loopback to test server behavior.

Default database path outside Docker is `data/tracker.sqlite`; production Docker uses `/data/tracker.sqlite`. Migrations resolve from `database/migrations` under the repo root or MIGRATIONS_PATH. Never commit `.env`, data, logs, backups or populated callback credentials.
