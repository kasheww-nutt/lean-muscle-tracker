#!/bin/sh
set -eu
exec node /tools/database-tools.mjs restore "$@"
