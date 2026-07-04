-- ============================================================================
-- DSUSA Migration 0004 — Rules Engine (PMS-4)  [POLICY-CRITICAL]
--
-- Two engine-owned tables ONLY:
--   - rule_set: immutable versioned rule sets (external policy DATA, not engine code).
--   - rule_evaluation: append-only evaluation records for replay + explainability.
-- NO business tables. The engine reads/writes only these + emits audit.
-- Forward-only; reversible via 0004_down.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rule_set (
  rule_set_id    text NOT NULL,
  version        integer NOT NULL,
  rules          jsonb NOT NULL,           -- the rule AST (data)
  default_effect text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_set_id, version)         -- immutable identity
);

-- Immutability: block UPDATE/DELETE so a published rule-set version can never change (rule history).
CREATE OR REPLACE FUNCTION rule_set_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'rule_set versions are immutable (PMS-4): % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rule_set_no_mutate ON rule_set;
CREATE TRIGGER rule_set_no_mutate
  BEFORE UPDATE OR DELETE ON rule_set
  FOR EACH ROW EXECUTE FUNCTION rule_set_immutable();

CREATE TABLE IF NOT EXISTS rule_evaluation (
  evaluation_id   text PRIMARY KEY,
  rule_set_id     text NOT NULL,
  version         integer NOT NULL,
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  inputs          jsonb NOT NULL,          -- supplied inputs (frozen) -> replay
  effects         jsonb NOT NULL,
  fired_rules     jsonb NOT NULL,
  resolved_effect text NOT NULL,
  explanation     text NOT NULL,
  correlation_id  text NOT NULL,
  audit_ref       text NOT NULL,
  dry_run         boolean NOT NULL DEFAULT false,
  FOREIGN KEY (rule_set_id, version) REFERENCES rule_set (rule_set_id, version)
);

CREATE INDEX IF NOT EXISTS rule_evaluation_set ON rule_evaluation (rule_set_id, version, evaluated_at);
CREATE INDEX IF NOT EXISTS rule_evaluation_corr ON rule_evaluation (correlation_id);

-- Append-only evaluation log: block UPDATE/DELETE.
CREATE OR REPLACE FUNCTION rule_evaluation_no_mutate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'rule_evaluation is append-only (PMS-4): % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rule_evaluation_block_mutate ON rule_evaluation;
CREATE TRIGGER rule_evaluation_block_mutate
  BEFORE UPDATE OR DELETE ON rule_evaluation
  FOR EACH ROW EXECUTE FUNCTION rule_evaluation_no_mutate();
