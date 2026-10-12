#!/bin/sh
set -eu
umask 077
: "${DATABASE_URL:?Configure DATABASE_URL}"
# libpq takes connection options from PGDATABASE; the secret never enters argv.
export PGDATABASE="$DATABASE_URL"
case "${DATABASE_SSL_MODE:-verify-full}" in
  verify-full) export PGSSLMODE=verify-full; if [ -n "${DATABASE_SSL_CA_FILE:-}" ]; then export PGSSLROOTCERT="$DATABASE_SSL_CA_FILE"; fi ;;
  disable) export PGSSLMODE=disable ;;
  *) echo 'Invalid DATABASE_SSL_MODE' >&2; exit 1 ;;
esac
mkdir -p /backups
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
file="/backups/tracker-$stamp.dump"
trap 'rm -f "$file.partial"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$file.partial"
mv "$file.partial" "$file"
printf '%s\n' "$file"
