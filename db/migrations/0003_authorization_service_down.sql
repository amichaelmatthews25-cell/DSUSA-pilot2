-- Rollback for 0003 — Authorization Service
-- NOTE: the decision log is an audit artifact; production rollback archives rather than drops.
DROP TRIGGER IF EXISTS authz_decision_block_mutate ON authorization_decision_log;
DROP FUNCTION IF EXISTS authz_decision_no_mutate();
DROP TABLE IF EXISTS authorization_decision_log;
