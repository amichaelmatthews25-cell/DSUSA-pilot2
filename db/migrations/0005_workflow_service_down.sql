-- Rollback for 0005 — Workflow Service
DROP TABLE IF EXISTS workflow_execution;
DROP TRIGGER IF EXISTS workflow_definition_no_mutate ON workflow_definition;
DROP FUNCTION IF EXISTS workflow_definition_immutable();
DROP TABLE IF EXISTS workflow_definition;
