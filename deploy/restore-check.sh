#!/usr/bin/env bash
# Restore drill: loads a dump into a throw-away Postgres and prints row counts, so a backup is proven restorable.
#   deploy/restore-check.sh backups/shop-XXXX.sql.gz
set -euo pipefail
DUMP="${1:?usage: restore-check.sh <dump.sql.gz>}"
NAME="shop-restore-check-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker exec "$NAME" psql -U postgres -c 'CREATE DATABASE shop' >/dev/null
gunzip -c "$DUMP" | docker exec -i "$NAME" psql -U postgres -d shop -v ON_ERROR_STOP=1 >/dev/null
docker exec "$NAME" psql -U postgres -d shop -c "select (select count(*) from products) as products, (select count(*) from orders) as orders, (select count(*) from customers) as customers"
echo "restore OK"
