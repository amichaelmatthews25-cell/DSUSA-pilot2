#!/usr/bin/env bash
# DSUSA F0 rollback — applies *_down.sql in REVERSE order.
# WARNING: 0001 down drops audit data; in production this is an ARCHIVE with governance sign-off,
# never a blind drop (PMS-1 §14 / Retention reconciliation). Non-prod convenience here.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
: "${CONFIRM_DESTRUCTIVE:?set CONFIRM_DESTRUCTIVE=yes to proceed}"
[ "$CONFIRM_DESTRUCTIVE" = "yes" ] || { echo "refusing without CONFIRM_DESTRUCTIVE=yes"; exit 1; }
MIGRATIONS_DIR="$(dirname "$0")/../../db/migrations"
for f in $(ls "$MIGRATIONS_DIR"/*_down.sql | sort -r); do
  echo "  <- $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "[F0] rollback complete."
