# Lean Muscle Tracker — AWS edition

Single-owner fitness and nutrition tracker with the original lavender React UI, meals, water, body weights, workouts, searchable history, PWA assets, widgets and MCP logging.

The backend runs on Node.js 24 with Next.js and shared PostgreSQL (Amazon RDS / PostgreSQL 16) across two EC2 instances behind an Application Load Balancer. Single-instance SQLite mode is also supported for lightweight local evaluation.

## Start on EC2

```sh
npm ci
npm run typecheck
npm test
npm run build
cp .env.example .env
# Configure DATABASE_URL, identical secrets, and REPLICA_ID (ec2-a or ec2-b).
# Generate independent secrets with: openssl rand -hex 32
chmod 600 .env
# Run migrations once before starting containers:
docker compose run --rm --no-deps tracker node scripts/migrate.mjs
# Start behind ALB:
TRACKER_BIND_ADDRESS=0.0.0.0 docker compose up -d --build --wait
```

ALB terminates HTTPS and forwards HTTP to port 5173 on both EC2 targets. `PUBLIC_BASE_URL` is the externally visible HTTPS origin. Set ALB health checks to `/api/health`, HTTP 200. A verified custom domain and ACM certificate provide the public HTTPS endpoint.

Database storage is hosted on the shared PostgreSQL instance. Both application containers run stateless with `DATABASE_AUTO_MIGRATE=0` to prevent concurrent startup migrations. Backups are performed via `db-tools` (`/tools/backup.sh`) and RDS automated backups.

## Verify

```sh
npm run typecheck
npm test
npm run check:public
npm run build
node scripts/smoke.mjs
npm audit --omit=dev
```

The smoke test launches the actual production server, verifies PIN and OAuth authentication, logs and corrects synthetic records through MCP, checks nutrition totals, restarts the server, and verifies an online database backup and restore. Its temporary database is removed afterward. Run from the repo root; port 5173 must be available.

## Authentication

- Browser: existing PIN screen, signed HttpOnly/Secure cookie, same-origin mutation checks and persistent attempt limits.
- ChatGPT MCP: authorization-code OAuth with S256 PKCE, explicit owner consent, registered callback allowlist, resource-bound tokens, refresh rotation and revocation. Configure client ID/secret and exact callback URIs from the client. There is no dynamic registration endpoint.
- Direct MCP clients: optional private bearer token. Never publish it or place it in a URL.
- Cognito SSO: optional `/sso/login` with PKCE, signed state, nonce and signed Cognito identity validation. Only `COGNITO_OWNER_SUB` may unlock this private tracker. AWS user pool/client/domain configuration is still required. The original dashboard UI has no new SSO button; visit the dedicated URL.

Keep ALB routing to `/mcp`, `/oauth/*` and `/.well-known/*` free of interactive ALB login actions. ChatGPT authenticates with its bearer token. Live ChatGPT connection and Cognito login must be verified after cloud setup.

## Layout

| Directory | Purpose |
|---|---|
| frontend | Original UI and Next.js route adapters |
| backend/api | Dashboard, history, widget, access, OAuth and SSO handlers |
| backend/mcp | Tool schemas and record operations |
| backend/services | SQLite adapter, sessions, security and calculations |
| database | SQLite schema and append-only migrations |
| infrastructure | Production container and AWS configuration guidance |
| scripts | Startup validation, online backup and production smoke check |
| .github/workflows | Verification and EC2 deployment through OIDC/SSM |
| tests | Synthetic domain, API, OAuth, persistence and identity tests |
| docs | Setup, API, security, architecture and tonight's checklist |

## Scope

This is a private single-owner application with high-availability support: two EC2 application instances behind an Application Load Balancer connected to a shared PostgreSQL database. Both instances share identical session signing keys, owner ID, and OAuth configurations. Zero inter-instance messaging is required. Automatic rolling deployments update one target at a time with zero user-facing downtime.

AWS deployment and costs have not been verified from this workspace. See [tonight's steps](docs/tonight.md), [AWS setup](infrastructure/aws/README.md), [security](docs/security.md) and [validation](docs/validation.md).
