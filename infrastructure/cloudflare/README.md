# Cloudflare deployment: fresh database, no AWS account

The original lavender UI is exported as static files. A public router Worker serves those assets and distributes API/OAuth/MCP requests across two private backend Workers via service bindings. Both use one Supabase PostgreSQL database. Supabase Auth verifies email OTPs delivered through Resend. The application continues issuing its own account-scoped MCP OAuth tokens.

This is a custom application load balancer, not Cloudflare's paid managed Load Balancing product. The two Workers are separate deployments, not independently provisioned physical servers or separate regional databases. Free CPU/usage allowances and Supabase inactivity pausing still apply.

## Completed account configuration

- Public origin: `https://tracker.kashewwnutt.tech`
- Supabase: `https://opjzjmmepjveasuohmej.supabase.co`
- The public publishable key is in both backend configuration files. It is not a database credential.
- Supabase Auth Site URL: public origin above.
- Allowed redirect: `https://tracker.kashewwnutt.tech/auth/callback`.
- Resend SMTP configured privately in Supabase.

## 1. Initialize the EMPTY database

Open `supabase-first-setup.sql` in this directory. Paste it into Supabase SQL Editor and run it **once**, only in this new empty project. It creates the tracker schema, matching migration checksums and restricted `tracker_app` role. It revokes anon/authenticated access to tracker tables and enables RLS. The backend role's policies allow its required work; end-user isolation remains enforced in the backend's account-scoped queries.

Set the role's password privately in SQL Editor:

```sql
ALTER ROLE tracker_app PASSWORD '<a-new-long-random-password>';
```

Never commit the filled command. Keep the password in a password manager. The role cannot run schema migrations or create tables.

## 2. Make Supabase emails contain the OTP

In Authentication → Email → Templates, update **Confirm signup** and **Magic link**. For example:

```html
<h2>Your Lean Muscle Tracker code</h2>
<p>Enter this code in the tracker:</p>
<p style="font-size:28px;font-weight:bold">{{ .Token }}</p>
<p>If you did not request this email, ignore it.</p>
```

Keep email confirmation enabled. Configure email OTP expiry to 10 minutes and retain rate limits. The app accepts the emailed code in a browser-state-bound form; it does not use a default magic-link callback. Login and fresh account creation use email OTP, so no old Cognito password is needed. Password login and Google/social SSO are not implemented by this migration.

## 3. Prepare local tooling

With Node.js 24 installed, clone the repository, then:

```bash
npm ci
npm run typecheck
npm run typecheck:cloudflare
npm test
npm run build:cloudflare
npm run test:cloudflare-runtime
npx wrangler login
```

Wrangler opens Cloudflare authorization in the browser. Authorize the correct account. No AWS credentials are used.

## 4. Prepare the runtime database connection

Supabase → Connect → Session pooler. Use port **5432** for both application and migration URLs, so the existing target guard can verify they address the same database. Use the project's actual pooler hostname, not the former RDS endpoint.

For the application URL, use username `tracker_app.<project-reference>` and the private role password. The project reference here is `opjzjmmepjveasuohmej`. URL-encode the password if it contains special characters. Remove `sslmode` and other SSL query parameters from the copied URL; the driver separately enforces `DATABASE_SSL_MODE=verify-full`. Do not disable TLS verification.

Example shape only:

```text
postgresql://tracker_app.opjzjmmepjveasuohmej:<URL-encoded-password>@<actual-session-pooler-host>:5432/postgres
```

Use the admin `postgres.<project-reference>` credentials only for migrations, with the same host, port, database and URL options. Do not paste either filled URL into chat, source code, screenshots or public logs.

## 5. Create the private Workers and set secrets

First create both private services. Until secrets exist they deliberately return 503:

```bash
npx wrangler deploy -c infrastructure/cloudflare/wrangler.a.jsonc
npx wrangler deploy -c infrastructure/cloudflare/wrangler.b.jsonc
```

Set the application database URL on each; Wrangler prompts privately:

```bash
npx wrangler secret put DATABASE_URL -c infrastructure/cloudflare/wrangler.a.jsonc
npx wrangler secret put DATABASE_URL -c infrastructure/cloudflare/wrangler.b.jsonc
```

Generate a strong random session secret on your own computer, save it privately, and enter the **same value** for both prompts:

```bash
npx wrangler secret put TRACKER_SESSION_SECRET -c infrastructure/cloudflare/wrangler.a.jsonc
npx wrangler secret put TRACKER_SESSION_SECRET -c infrastructure/cloudflare/wrangler.b.jsonc
```

Use at least 32 random characters. Do not rotate this value on every deployment. Neither a Supabase privileged API key nor the Resend key is required by the Workers: Resend credentials stay inside Supabase SMTP settings.

## 6. Publish the router

```bash
npx wrangler deploy -c infrastructure/cloudflare/wrangler.router.jsonc
```

This attaches the custom domain. Resolve any old conflicting `tracker` DNS record in Cloudflare if prompted. Backend A/B have `workers_dev:false`, no public routes, and preview URLs disabled. Only the router is public.

Check `https://tracker.kashewwnutt.tech/api/ready`; then open the site and use your email code to sign in. A backend's database access uses a request-scoped pool, maximum four connections, closed when that request finishes. No TCP socket is reused between Workers request contexts.

## 7. Reconnect ChatGPT

MCP URL: `https://tracker.kashewwnutt.tech/mcp`.

Client ID: `lean-tracker-chatgpt`.

The currently configured exact callback is `https://chatgpt.com/connector/oauth/DeIABnEHrZpO`. Verify your existing app still uses it. If recreating an app, add its newly generated exact callback to `OAUTH_REDIRECT_URIS` in **both** configurations, then redeploy. Never use a wildcard or a Cognito client ID.

Reconnect, sign in using the email OTP, then approve the account-specific consent page. Old AWS tokens do not exist in the new database. Test a read, then an explicitly authorized write and read-back. No DCR, CIMD or public app publication is added here.

## 8. Automatic deployment

The old AWS workflow is retired. The Cloudflare workflow verifies on pushes and PRs, but production deployment stays **disabled** until the first manual setup is working.

Repository variables:

- `CLOUDFLARE_ACCOUNT_ID`: your account ID.
- `CLOUDFLARE_DEPLOY_ENABLED`: set `true` only after initial setup passes.

Repository/environment secrets:

- `CLOUDFLARE_API_TOKEN`: narrowly scoped for Workers deployment on this account, plus the zone permissions required for the router's custom domain.
- `TRACKER_DATABASE_URL`: restricted runtime role connection.
- `TRACKER_DATABASE_MIGRATION_URL`: migration administrator connection, same destination.
- `TRACKER_SESSION_SECRET`: exactly the existing shared secret.

The workflow validates, builds, updates private replica secrets, applies migrations, deploys B, verifies B through the public router, deploys A, verifies A, then deploys/verifies the router. Migration compatibility with the still-running previous version is required. There is no automatic database rollback. The role grants/security SQL must be updated if future migrations add tables.

The reusable deployment script needs both database URLs in the caller's private environment. `--initial` is only for a deliberate first deployment; normal updates require production readiness first.

## 9. Demonstrate traffic distribution and failure handling

Repeated `/api/health` requests show `replica-a` and `replica-b`; routing is random approximately 50/50, not strict alternation. Both replicas use the same account session and database.

For a controlled demo, with automatic deployment idle:

1. Set `REPLICA_ENABLED` to `false` in A's local configuration and deploy A only.
2. Request public health/read endpoints repeatedly. The router probes A, finds it unavailable, and forwards to B.
3. Restore A to `true` and redeploy A. Verify both identities return again.
4. Do not commit an accidental disabled setting. CI reads the configuration files and would otherwise deploy it later.

This demonstrates application-level failover. Router checks use backend liveness; `/api/ready` separately verifies database readiness. Failure of the shared database can affect both replicas.

The router chooses another replica **before forwarding a request** if a health probe fails. Once a request is forwarded, it never automatically replays it after an ambiguous error, including OAuth token exchanges and MCP writes. The caller receives 503 and must inspect the outcome. Manual forms retain their stable UUID duplicate protection. It does not yet implement a distributed health cache/circuit breaker or independent failure domains.

## Verification boundaries

- Existing unit tests plus new OTP state/verified-user, request-context isolation and router failure tests.
- Worker-specific TypeScript checks.
- Static dashboard build and actual workerd runtime smoke test.
- Restricted-role and schema test runs with a real disposable PostgreSQL database in CI.
- Live email delivery, database TLS/permissions, end-to-end MCP and free CPU allowance are verified after private credentials and domain deployment are configured.
- Signed browser sessions currently retain the existing 30-day application lifetime. Logout clears that browser cookie; it does not revoke all MCP tokens or every other session.
- Supabase Free may pause inactive projects and does not provide automatic backups. Set up independent encrypted exports and test restoration.

The academic report/PPT files and the earlier AWS handover are intentionally unchanged. This directory describes the new deployment.
