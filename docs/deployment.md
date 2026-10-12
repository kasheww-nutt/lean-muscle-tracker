# Deployment

Follow `infrastructure/aws/README.md`. The image builds the production Next.js bundle, prunes development dependencies, runs as non-root and listens on port 5173. Compose stores the database on a named volume and applies restart, health check and log rotation settings.

CI builds and tests each push/PR. The deploy workflow stays inactive until AWS_REGION, EC2_INSTANCE_ID and AWS_DEPLOY_ROLE_ARN are configured as repository variables. It then runs after successful main-branch push verification, or manually on main, and assumes an AWS OIDC role. Systems Manager checks out the exact verified SHA, builds the image, takes an online database backup if a container is running, starts the replacement and checks health. Configure the production GitHub environment and AWS variables first. This workflow has not been run in the user's AWS account.

For rollback, check out a previously known-good application commit, rebuild and restart using the same volume. Migrations are append-only and may prevent older code from running; do not automatically roll back database schema. Keep a database backup and verify compatibility before rolling back. Deploy is not zero-downtime and has no automatic code rollback.

Backup: `docker compose exec -T tracker node scripts/backup.mjs`. Copy `/data/backups` to private off-instance storage and set retention. To restore, stop the app, save the current DB, restore a selected backup to `/data/tracker.sqlite`, remove stale WAL/SHM files while the app is stopped, ensure node UID 1000 owns the files, and restart. Test on a separate disposable volume first.
