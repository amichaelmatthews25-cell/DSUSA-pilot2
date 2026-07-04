-- ============================================================================
-- DSUSA Migration 0005 — Workflow Service (PMS-5)  [ORCHESTRATION-CRITICAL]
--
-- Two engine-owned tables ONLY:
--   - workflow_definition: immutable versioned step DAGs (external data, not engine code).
--   - workflow_execution: durable execution state (resumable; snapshot of completed/pending steps).
-- NO business tables. Business work is delegated to step handlers OUTSIDE the engine.
-- Forward-only; reversible via 0005_down.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflow_definition (
  workflow_id text NOT NULL,
  version     integer NOT NULL,
  steps       jsonb NOT NULL,           -- the step DAG (data)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, version)       -- immutable identity
);

-- Immutability: published workflow versions never change.
CREATE OR REPLACE FUNCTION workflow_definition_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'workflow_definition versions are immutable (PMS-5): % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS workflow_definition_no_mutate ON workflow_definition;
CREATE TRIGGER workflow_definition_no_mutate
  BEFORE UPDATE OR DELETE ON workflow_definition
  FOR EACH ROW EXECUTE FUNCTION workflow_definition_immutable();

CREATE TABLE IF NOT EXISTS workflow_execution (
  execution_id    text PRIMARY KEY,
  workflow_id     text NOT NULL,
  version         integer NOT NULL,
  state           text NOT NULL
                    CHECK (state IN ('running','paused','completed','failed','compensating','compensated')),
  inputs          jsonb NOT NULL,
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_steps   jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  correlation_id  text NOT NULL,
  audit_ref       text NOT NULL,
  explanation     text NOT NULL DEFAULT '',
  dry_run         boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL,
  FOREIGN KEY (workflow_id, version) REFERENCES workflow_definition (workflow_id, version)
);

-- Idempotent start: a duplicated start key cannot create two executions.
CREATE UNIQUE INDEX IF NOT EXISTS workflow_execution_idem ON workflow_execution (idempotency_key);
CREATE INDEX IF NOT EXISTS workflow_execution_state ON workflow_execution (state, updated_at);
CREATE INDEX IF NOT EXISTS workflow_execution_corr ON workflow_execution (correlation_id);

-- workflow_execution rows are UPDATEd as the execution progresses (resumable state), so it is NOT
-- append-only. Its full transition history lives in the Audit log (PMS-1) via correlation_id.
