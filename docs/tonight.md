# Tonight: deployment and evidence

Backend work is implemented locally. Complete these in order:

1. Push the corrected source to the user's GitHub repository. Avoid wrapping the project in an extra nesting folder. Confirm the CI job passes.
2. Launch/configure Ubuntu EC2 with Docker Compose, encrypted EBS and an instance role for Systems Manager. Keep source at `/opt/lean-muscle-tracker`. Use one application target for the SQLite version.
3. Put populated environment values in `/opt/lean-muscle-tracker.env` with mode 600. Set the public HTTPS origin, owner ID, four-digit PIN, independent secrets and optional OAuth/SSO configuration.
4. Set up an internet-facing ALB across two subnets/AZs. Add HTTP target group port 5173, health path `/api/health`, and register EC2. Limit EC2 port 5173 to the ALB security group. Allow public ALB 443 and redirect 80 to HTTPS.
5. Validate an ACM certificate for a domain the user controls; attach it to ALB HTTPS. Point DNS to the ALB. Start the app using the documented Compose overrides and verify the public link.
6. Configure GitHub's production environment, OIDC role and repository variables. Run one successful automated EC2 deployment.
7. Configure Cognito user pool, app client and hosted/managed-login domain. Enable authorization-code flow, openid and callback PUBLIC_BASE_URL + `/sso/callback`. Set the exact owner sub. Test `/sso/login`. Google federation requires a separate Google OAuth app/client configuration; basic Cognito sign-in is not Google SSO by itself.
8. Configure the ChatGPT app with the new HTTPS `/mcp` endpoint, OAuth client ID/secret and exact allowed callbacks. Test logging, correction and readback. Do not disconnect the original tracker until this works.
9. Test a container restart with an actual synthetic log, show that data survives, take a backup and restore to a disposable volume. Copy production backups off-instance.
10. Configure monitoring/alarms and capture EC2, ALB target health, HTTPS, Cognito, CI/CD, dashboard and MCP screenshots. Write the faculty-format report with only verified evidence and the GitHub/deployment links.

Still needed from the user: GitHub repository URL, AWS region/EC2 instance details or an authorized access route, domain/DNS control, and the faculty's report format. No AWS deployment, DNS change, GitHub push, or live account migration has been performed from this ZIP-only workspace.

Do not describe this as PostgreSQL, multi-user authentication, automatic nutrition AI on EC2 or high availability. These features are not implemented. Deadline: 14 October 2026; tonight's immediate priority is a publicly reachable HTTPS EC2 deployment and successful CI/CD.
