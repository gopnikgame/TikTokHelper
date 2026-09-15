#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  db_password="$(cat /run/secrets/db_password)"
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${db_password}@db:5432/${POSTGRES_DB}"
fi

if [ -z "${VLINE_BRIDGE_CLIENT_SECRET:-}" ] && [ -f /run/secrets/tiktok_helper_client_secret ]; then
  VLINE_BRIDGE_CLIENT_SECRET="$(cat /run/secrets/tiktok_helper_client_secret)"
  export VLINE_BRIDGE_CLIENT_SECRET
fi

exec "$@"
