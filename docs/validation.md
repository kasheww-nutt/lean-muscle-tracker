# Local validation — AWS edition

Verified on 12 October 2026 using Node.js 24.19.0 and Next.js 16.4.0:

- TypeScript checking passes with no emit.
- All 16 test checks pass: nutrition/date calculations, API owner isolation, widget credentials, OAuth consent/PKCE/resource binding, token expiry/replay/refresh/revocation, persistent SQLite migrations, PIN throttling, and Cognito signed-identity validation.
- Production Next.js build passes and includes the dashboard, history, access, widget, MCP, OAuth discovery/authorization/token/revocation, SSO and health routes.
- Production HTTP smoke test exercises the built server: public UI/health, rejected unauthenticated access, PIN session, MCP handshake/tool listing, OAuth consent and token exchange, code replay rejection, OAuth-authenticated logging, meal corrections, test-meal exclusion, water corrections, body weight and computed workout volume.
- The smoke test restarts the application and verifies saved data and OAuth credentials survive. It creates an online SQLite backup, removes saved records, restores the backup while the application is stopped, and verifies the restored records through HTTP.
- A separate production directory with a fresh `npm ci --omit=dev` and the final image's application file layout passes the same HTTP smoke test. Development dependencies are not needed at runtime.
- `npm audit --omit=dev` reports zero known dependency vulnerabilities at the time checked. This is not a security audit or a guarantee about undiscovered issues.
- Original UI components, CSS and public assets match the uploaded ZIP byte-for-byte. Only runtime/backend/configuration/docs/tests were adapted.
- Source publication guard passes; no production database or credentials are included.

An end-to-end check exposed an OAuth route-context bug: re-exporting a two-argument token function made Next.js's route context look like a revocation flag. The route now calls the function explicitly with just the request; the production HTTP code exchange verifies this fix.

## Not yet verified

Docker is not installed in this environment, so the Docker image itself has not been built or run locally. The production layout test is additional evidence, not a substitute for Docker execution. CI includes a Docker build and runs the same smoke test inside the resulting container.

AWS resources, ALB HTTPS, actual Cognito sign-in, the live ChatGPT OAuth connection, GitHub Actions and cloud backup/monitoring are pending. No AWS deployment, GitHub push, DNS change or production record migration has been performed. Browser/mobile visual interaction has not been tested in this run. The restored backup test uses disposable synthetic data; a separate EC2 container restart/restore should be demonstrated after deployment.
