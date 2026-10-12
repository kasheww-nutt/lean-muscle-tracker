# Deployment

Follow `infrastructure/aws/README.md`. The Docker image builds the production Next.js bundle, prunes development dependencies, runs as non-root (node UID 1000) and listens on port 5173. Both EC2 instances run identical application containers with `DATABASE_DRIVER=postgres` and `DATABASE_AUTO_MIGRATE=0`.

CI builds and tests each push/PR (including multi-replica and PostgreSQL smoke tests). The deploy workflow runs on the deployment branch after successful CI, or manually, assuming an AWS OIDC role with least-privilege SSM and ELBv2 permissions. It requires repository variables: `AWS_REGION`, `EC2_INSTANCE_IDS` (two comma-separated instance IDs), `ALB_TARGET_GROUP_ARN`, and `AWS_DEPLOY_ROLE_ARN`.

The rolling deployment script (`.github/scripts/deploy_ec2.py`) performs:
1. Shared configuration fingerprint verification across both instances via SSM (`scripts/config-fingerprint.mjs`).
2. Pre-deployment PostgreSQL backup via `db-tools` (`/tools/backup.sh`).
3. Single migration execution under an exclusive advisory lock on the first target (`scripts/migrate.mjs`).
4. Rolling target replacement: drains target 1 from the ALB target group, restarts with the verified SHA, verifies `/api/health`, re-registers target 1, waits for healthy, and then repeats for target 2. Zero-downtime is maintained throughout rollout.

For rollback, check out a previously known-good application commit and re-deploy. Migrations are append-only. Keep a pre-deployment database backup and verify compatibility before rolling back.

PostgreSQL Backups: run `docker compose --profile tools run --rm db-tools /tools/backup.sh`. Backups are stored in custom format under `/backups` (host `/opt/lean-tracker-backups`). Amazon RDS automated snapshots provide point-in-time recovery. To test restore on a disposable database: `docker compose --profile tools run --rm -e RESTORE_CONFIRM=disposable-database-only db-tools /tools/restore.sh <backup-file>`.
