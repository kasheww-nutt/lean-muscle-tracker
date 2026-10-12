# AWS setup for the corrected backend

These are configuration instructions, not evidence of an existing deployment.

## EC2 and application

1. Use Ubuntu with enough memory/disk to build a Next.js image, encrypted EBS and an EC2 instance profile with AmazonSSMManagedInstanceCore. Confirm the instance appears online in Systems Manager. It needs outbound access to package registries, GitHub and SSM (internet routing or appropriate VPC endpoints).
2. Install Git, Docker Engine and the Compose plugin using the current official Docker Ubuntu instructions. Confirm `docker compose version` works.
3. Clone the public source into `/opt/lean-muscle-tracker`. This directory must contain package.json, docker-compose.yml and frontend/, not another nested project folder.
4. Copy .env.example to `/opt/lean-muscle-tracker.env`, edit all values, and `chmod 600 /opt/lean-muscle-tracker.env`. Do not store this file in GitHub. The original UI accepts a four-digit PIN; use a new random PIN and independent random session/MCP/OAuth secrets.
5. After restricting the EC2 security group as below, run:

```sh
cd /opt/lean-muscle-tracker
export TRACKER_ENV_FILE=/opt/lean-muscle-tracker.env
export TRACKER_BIND_ADDRESS=0.0.0.0
docker compose up -d --build --wait
curl --fail http://localhost:5173/api/health
docker compose logs --tail=50
```

## ALB, HTTPS and DNS

- Create the ALB in the same VPC using two public subnets in different availability zones.
- ALB security group: inbound 443 (and 80 for redirect); outbound TCP 5173 to the application's security group.
- EC2 security group: inbound TCP 5173 ONLY from the ALB security group. Use SSM; no public SSH rule is required. Do not expose SQLite/database ports or direct app access to the internet.
- HTTP instance target group, port 5173, health path `/api/health`, success code 200. Register the EC2 instance and wait for healthy.
- Obtain an ACM certificate in the ALB's region for a domain the user controls, complete DNS validation, create the 443 listener and forward to the target group. Redirect listener 80 to HTTPS.
- Point the domain to the ALB and set PUBLIC_BASE_URL to that HTTPS origin. Do not use an IP address or an ALB AWS hostname with a certificate issued for a different domain.
- Forward application routes normally. Do not enable a universal interactive ALB authentication action that would redirect MCP calls into browser login.

One target is supported. SQLite is local to this instance; adding a second independent target would split data. Use a shared database before multi-instance scaling. The ALB currently supplies routing/TLS/health checking, not highly available storage or application failover.

## GitHub CI/CD with OIDC and SSM

1. Add GitHub OIDC provider `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`, in IAM.
2. Create a deployment role using the trust-policy template. Replace ACCOUNT_ID, GITHUB_OWNER and GITHUB_REPO; do not use a wildcard sub. The workflow uses GitHub environment `production`, so the trust sub is `repo:OWNER/REPO:environment:production`, not a branch-only sub.
3. Give it the SSM permissions template after replacing REGION, ACCOUNT_ID and INSTANCE_ID. Restrict SendCommand to the one target instance and AWS-RunShellScript document. Do not attach AdministratorAccess.
4. Create the GitHub `production` environment and restrict deployments to main. Configure repository variables `AWS_REGION`, `EC2_INSTANCE_ID`, `AWS_DEPLOY_ROLE_ARN`.
5. Push main and wait for Test and build to succeed, then Deploy EC2. SSM checks out the verified SHA on the existing clone, builds, backs up if running, updates and checks health. Manual deployment is restricted to main as well.
6. Capture a successful GitHub Actions run and SSM command result. The workflow is prepared but not connected/tested in AWS yet.

No AWS access keys are stored in the repository. The deployment workflow expects a public GitHub repository; private repository access needs a separately configured safe authentication mechanism on EC2.

## Cognito SSO

Create a user pool, app client and Cognito hosted/managed-login domain. Enable authorization-code flow and openid scope; configure callback `https://YOUR_DOMAIN/sso/callback`. Set COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, optional COGNITO_CLIENT_SECRET, COGNITO_DOMAIN (HTTPS origin) and the owner's exact COGNITO_OWNER_SUB. Visit `https://YOUR_DOMAIN/sso/login` to test. No dashboard design change is required. Enable MFA if appropriate to the demonstration.

Google federation needs a Google OAuth application, its credentials and Cognito provider configuration; merely creating a user pool does not demonstrate Google SSO. Verify successful sign-in and rejection of a different account. Do not allow all pool users to share this private owner's records.

## Monitoring and recovery

EC2 basic metrics and ALB target metrics can be inspected in CloudWatch. Configure alarms for unhealthy targets and resource pressure, and a CloudWatch agent if application/memory logs are required. Docker logs rotate locally; CloudWatch log shipping is not installed by this code.

Take an online backup with `docker compose exec -T tracker node scripts/backup.mjs`. Schedule backup copies to private off-instance storage with encryption and retention, and demonstrate a restore on a disposable volume. Do not put personal data in the public repository or report screenshots. Document resource cleanup after evaluation; ALB, EBS and public addresses may continue to incur charges.

## Official references

- https://nextjs.org/docs/app/guides/self-hosting
- https://docs.docker.com/engine/install/ubuntu/
- https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html
- https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
