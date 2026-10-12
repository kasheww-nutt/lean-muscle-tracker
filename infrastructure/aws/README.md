# AWS setup for the corrected backend

These are configuration instructions, not evidence of an existing deployment.

## Two EC2 instances and shared RDS PostgreSQL

1. **Amazon RDS PostgreSQL:**
   - Launch an Amazon RDS PostgreSQL 16 database instance (e.g. `db.t4g.micro` for budget-conscious workloads, or Multi-AZ for high availability).
   - Security group: inbound TCP 5432 ONLY from the EC2 application security group. Do not make RDS publicly accessible.
   - Enforce TLS (`rds.force_ssl=1` parameter group). Download the AWS global bundle CA certificate to `/opt/lean-muscle-tracker.ca.pem` on each EC2 instance.
   - Note the connection string: `postgresql://<user>:<password>@<rds-endpoint>:5432/<database>`.

2. **EC2 Instances (Two targets):**
   - Launch two Ubuntu EC2 instances in different private (or public) subnets across two AZs.
   - Attach an EC2 instance profile with `AmazonSSMManagedInstanceCore` to both instances. Confirm both appear online in Systems Manager.
   - Install Git, Docker Engine and the Compose plugin on both instances.
   - Clone the source into `/opt/lean-muscle-tracker` on both instances.
   - Copy `.env.example` to `/opt/lean-muscle-tracker.env` on both instances:
     - Set identical `DATABASE_URL`, `DATABASE_SSL_MODE=verify-full`, `TRACKER_OWNER_ID`, `TRACKER_ACCESS_CODE`, `TRACKER_SESSION_SECRET`, `PUBLIC_BASE_URL`, and OAuth/Cognito keys.
     - Set `REPLICA_ID=ec2-a` on instance 1 and `REPLICA_ID=ec2-b` on instance 2.
     - `chmod 600 /opt/lean-muscle-tracker.env`.
   - Run initial migrations once before startup:
     ```sh
     cd /opt/lean-muscle-tracker
     export TRACKER_ENV_FILE=/opt/lean-muscle-tracker.env
     docker compose run --rm --no-deps tracker node scripts/migrate.mjs
     ```
   - Start the container:
     ```sh
     export TRACKER_BIND_ADDRESS=0.0.0.0
     docker compose up -d --build --wait
     curl --fail http://localhost:5173/api/health
     ```

## ALB, HTTPS and DNS

- Create the ALB using two public subnets in different availability zones.
- **ALB security group:** inbound 443 (and 80 for redirect); outbound TCP 5173 to the EC2 security group.
- **EC2 security group:** inbound TCP 5173 ONLY from the ALB security group. Outbound TCP 5432 to the RDS security group. Outbound 443 for Systems Manager/package downloads.
- **HTTP Target Group:** target type `instance`, port 5173, health path `/api/health`, success code 200. Register both EC2 instances (port 5173).
- **HTTPS Listener (443):** Attach ACM certificate for your domain, forward to the target group.
- **HTTP Listener (80):** Redirect 80 to HTTPS 443.
- Set `PUBLIC_BASE_URL` to the public HTTPS domain. Do not enable universal interactive ALB authentication in front of `/mcp` or `/oauth/*`.

Both application targets are stateless and share the same PostgreSQL database and HMAC session secret. Requests can be routed to either healthy target without sticky sessions.

## GitHub CI/CD with OIDC and SSM

1. Add GitHub OIDC provider `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`, in IAM.
2. Create a deployment role using `infrastructure/aws/github-oidc-trust.json`. Replace `ACCOUNT_ID`, `GITHUB_OWNER` and `GITHUB_REPO`.
3. Attach policy `infrastructure/aws/github-deploy-permissions.json`. Replace `REGION`, `ACCOUNT_ID`, and list both EC2 instance IDs.
4. In GitHub repository Settings > Secrets and variables > Actions > Variables, configure:
   - `AWS_REGION`: target AWS region (e.g. `ap-south-1` or `us-east-1`)
   - `EC2_INSTANCE_IDS`: comma-separated instance IDs, e.g. `i-0123456789abcdef0,i-0123456789abcdef1`
   - `ALB_TARGET_GROUP_ARN`: full ARN of the ALB target group
   - `AWS_DEPLOY_ROLE_ARN`: full ARN of the IAM OIDC deployment role
5. Pushes to the deployment branch trigger automated rolling deployment via `.github/scripts/deploy_ec2.py`. SSM verifies shared configuration fingerprints, takes a pre-deployment backup, runs migrations once, and rolls instances one at a time.

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
