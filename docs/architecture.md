# Architecture

Browser and MCP clients → HTTPS Application Load Balancer → Two EC2 Instances (port 5173, replica-a & replica-b) → Node.js 24 / Next.js API handlers → Shared PostgreSQL (Amazon RDS / PostgreSQL 16) with TLS verify-full.

Cognito supplies optional browser SSO via `/sso/login` and `/sso/callback`. MCP has a separate OAuth authorization server and owner-scoped token validation. GitHub Actions verifies code and uses an IAM OIDC role plus Systems Manager to deploy an exact commit across both EC2 targets. CI/CD is separate from request handling.

Frontend markup, styling and visual components are retained. Runtime route adapters select the Node runtime. The PostgreSQL database adapter (`backend/services/postgres.ts`) provides connection pooling, advisory transaction locking for migrations, query translation (`?` to `$1`, `rowid` to `record_order`), and numeric JSON type safety. Browser sessions use stateless HMAC-SHA256 cookies with identical signing keys, enabling zero-session-stickiness request routing across both instances.

Backups use PostgreSQL custom format (`pg_dump` via `db-tools`) and RDS automated backups. Migrations are executed once under an exclusive advisory lock before instance replacement. High availability is provided across the two EC2 targets and optional Multi-AZ RDS.
