-- ============================================================================
-- DSUSA Migration 0003 — Authorization Service (PMS-3)  [SAFETY-CRITICAL]
--
-- This migration creates EXACTLY ONE table: an append-only decision LOG (a record for
-- reproducibility/audit). It deliberately creates NO standing table, NO eligibility table, and NO
-- enforcement cache — the Authorization Service COMPOSES authoritative facts owned by domain
-- producers and stores none of them. (composition, not origination)
--
-- The capability model + fact providers are runtime configuration/wiring, not authority state, and
-- are not persisted here as authority.
--
-- Forward-only; reversible via 0003_down.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS authorization_decision_log (
  decision_id             text PRIMARY KEY,
  allowed                 boolean NOT NULL,
  capability              text NOT NULL,
  subject_id              text NOT NULL,
  actor_type              dsusa_actor_type NOT NULL,
  actor_id                text NOT NULL,
  decided_at              timestamptz NOT NULL DEFAULT now(),
  correlation_id          text NOT NULL,
  -- The exact facts composed, frozen, so the decision is reproducible. NOT an authority store:
  -- these are a snapshot of what producers returned at decision time, never read for enforcement.
  composed_facts_snapshot jsonb NOT NULL,
  producing_services      jsonb NOT NULL,
  rules_version           integer NOT NULL,
  explanation             text NOT NULL,
  audit_ref               text NOT NULL,
  reasons                 jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Audit/reproduction read paths ONLY. Note: deliberately NO index that supports
-- "latest decision for a subject" — such a read would invite enforcement-cache misuse.
CREATE INDEX IF NOT EXISTS authz_decision_corr ON authorization_decision_log (correlation_id);
CREATE INDEX IF NOT EXISTS authz_decision_time ON authorization_decision_log (decided_at);

-- APPEND-ONLY: revoke UPDATE/DELETE for the app role; trigger guard regardless of grants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsusa_app') THEN
    EXECUTE 'GRANT INSERT, SELECT ON authorization_decision_log TO dsusa_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON authorization_decision_log FROM dsusa_app';
  END IF;
END$$;

CREATE OR REPLACE FUNCTION authz_decision_no_mutate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'authorization_decision_log is append-only (PMS-3): % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS authz_decision_block_mutate ON authorization_decision_log;
CREATE TRIGGER authz_decision_block_mutate
  BEFORE UPDATE OR DELETE ON authorization_decision_log
  FOR EACH ROW EXECUTE FUNCTION authz_decision_no_mutate();

-- CONSTITUTIONAL ASSERTION (documented, enforced by review + the absence of such tables):
-- There is no authorization-owned table named %standing%, %eligibility%, or %authority_cache%.
-- The Authorization Correctness Review (ops/verify) checks the migration text for these.
