# Architecture

Browser and MCP clients → HTTPS Application Load Balancer → EC2 port 5173 → Node.js 24 / Next.js API handlers → SQLite on EBS-backed Docker volume.

Cognito supplies optional browser SSO via `/sso/login` and `/sso/callback`. MCP has a separate OAuth authorization server and owner-scoped token validation. GitHub Actions verifies code and uses an IAM OIDC role plus Systems Manager to deploy an exact commit. CI/CD is separate from request handling.

Frontend markup, styling and visual components are retained. Runtime route adapters now select the Node runtime. The existing SQLite queries are preserved through a small adapter with `prepare/bind/all/first/run`. Migration history is transactional and recorded in `schema_migrations`. WAL and a busy timeout support reads and writes on this single host.

Backups use SQLite's online backup API. The volume survives container replacement, but is still on the instance's EBS disk. Off-instance backups and restore drills are cloud setup tasks. PostgreSQL, RDS, multiple targets, autoscaling, WAF and CloudWatch agent integration are not claimed as deployed.
