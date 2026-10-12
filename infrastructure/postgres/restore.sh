#!/bin/sh
set -eu
: "${DATABASE_URL:?Configure a disposable restore database URL}"
: "${RESTORE_CONFIRM:?Set RESTORE_CONFIRM=disposable-database-only after checking the target}"
[ "$RESTORE_CONFIRM" = disposable-database-only ] || exit 1
[ "$#" -eq 1 ] || { echo 'Supply one backup path mounted under /backups.' >&2; exit 1; }
case "$1" in /backups/*.dump) ;; *) echo 'Backup must be under /backups.' >&2; exit 1 ;; esac
export PGDATABASE="$DATABASE_URL" PGSSLMODE="${DATABASE_SSL_MODE:-verify-full}"
if [ -n "${DATABASE_SSL_CA_FILE:-}" ]; then export PGSSLROOTCERT="$DATABASE_SSL_CA_FILE"; fi
# Target must be a fresh, empty database. No --clean or implicit drop is performed.
pg_restore --exit-on-error --single-transaction --no-owner --no-acl "$1"
