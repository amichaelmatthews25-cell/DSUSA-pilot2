-- ============================================================================
-- DSUSA Migration 0001 — Audit Service (PMS-1)
-- Append-only, idempotency-keyed, correlation-tracked. Foundational.
-- Append-only is enforced at the GRANT level (UPDATE/DELETE revoked) — PMS-1 §14.
-- Forward-only; reversible via 0001_down.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_entry (
  id               bigserial PRIMARY KEY,
  actor_type       dsusa_actor_type NOT NULL,
  actor_id         text NOT NULL,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_component text NOT NULL,
  correlation_id   text NOT NULL,
  idempotency_key  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: (source_component, idempotency_key) unique — repeated write returns original (PMS-1 §11).
CREATE UNIQUE INDEX IF NOT EXISTS audit_entry_idem
  ON audit_entry (source_component, idempotency_key);

-- Query support (deterministic ordering by created_at, id).
CREATE INDEX IF NOT EXISTS audit_entry_entity ON audit_entry (entity_type, entity_id, created_at, id);
CREATE INDEX IF NOT EXISTS audit_entry_actor  ON audit_entry (actor_type, actor_id, created_at, id);
CREATE INDEX IF NOT EXISTS audit_entry_corr   ON audit_entry (correlation_id);

-- ---------------------------------------------------------------------------
-- APPEND-ONLY ENFORCEMENT (PMS-1 §14): revoke UPDATE/DELETE for the app role.
-- A dedicated break-glass role (audited separately) is the only path to mutate,
-- and that path is itself recorded (self-audit). Replace `dsusa_app` with the
-- deployment's application role.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsusa_app') THEN
    EXECUTE 'GRANT INSERT, SELECT ON audit_entry TO dsusa_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_entry FROM dsusa_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE audit_entry_id_seq TO dsusa_app';
  END IF;
END$$;

-- Belt-and-suspenders: a trigger that rejects UPDATE/DELETE regardless of grants.
CREATE OR REPLACE FUNCTION audit_entry_no_mutate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_entry is append-only (PMS-1): % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_entry_block_update ON audit_entry;
CREATE TRIGGER audit_entry_block_update
  BEFORE UPDATE OR DELETE ON audit_entry
  FOR EACH ROW EXECUTE FUNCTION audit_entry_no_mutate();
