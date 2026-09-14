#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  db_password="$(cat /run/secrets/db_password)"
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${db_password}@db:5432/${POSTGRES_DB}"
fi

exec "$@"
