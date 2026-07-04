#!/usr/bin/env bash
# DSUSA F0 deployment — auth substrate + Audit Service schema.
# Per Implementation Program §22: migrate (forward-only, reversible) -> smoke -> enable consumers.
# Idempotent: safe to re-run (migrations use IF NOT EXISTS; grants guarded).
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the target Postgres}"
MIGRATIONS_DIR="$(dirname "$0")/../../db/migrations"

echo "[F0] applying forward migrations in order..."
for f in $(ls "$MIGRATIONS_DIR"/*.sql | grep -v '_down.sql' | sort); do
  echo "  -> $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "[F0] smoke check: audit_entry append-only trigger present"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT 1 FROM pg_trigger WHERE tgname = 'audit_entry_block_update';" | grep -q 1

echo "[F0] deployment complete (schema). NOTE: deployment-complete != production-validated."
