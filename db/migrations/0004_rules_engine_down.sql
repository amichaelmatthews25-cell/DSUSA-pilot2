-- Rollback for 0004 — Rules Engine
DROP TRIGGER IF EXISTS rule_evaluation_block_mutate ON rule_evaluation;
DROP FUNCTION IF EXISTS rule_evaluation_no_mutate();
DROP TABLE IF EXISTS rule_evaluation;
DROP TRIGGER IF EXISTS rule_set_no_mutate ON rule_set;
DROP FUNCTION IF EXISTS rule_set_immutable();
DROP TABLE IF EXISTS rule_set;
