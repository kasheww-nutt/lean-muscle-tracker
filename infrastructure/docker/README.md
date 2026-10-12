# Production Docker

Build with `docker build -f infrastructure/docker/Dockerfile -t lean-muscle-tracker:local .` or `docker compose build`. The image uses Node.js 24, production Next.js output and a non-root runtime.

Set variables through `.env` or TRACKER_ENV_FILE. Default port binding is `127.0.0.1:5173`; ALB deployment uses TRACKER_BIND_ADDRESS=0.0.0.0 with the AWS security group restriction. Database and backups persist on `/data`. Never delete the volume during upgrades.

Docker is not installed in the code-fixing workspace, so container execution was not locally verified. CI includes a Docker build for verification in GitHub's runner.
