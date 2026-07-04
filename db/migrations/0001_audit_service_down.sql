-- Rollback for 0001 — Audit Service
-- NOTE: dropping audit data is destructive; in production this requires governance/legal sign-off
-- and is normally an ARCHIVE, not a DROP (PMS-1 §14 / Retention reconciliation). Provided for non-prod.
DROP TRIGGER IF EXISTS audit_entry_block_update ON audit_entry;
DROP FUNCTION IF EXISTS audit_entry_no_mutate();
DROP TABLE IF EXISTS audit_entry;
