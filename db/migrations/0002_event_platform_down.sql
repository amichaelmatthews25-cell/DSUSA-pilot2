-- Rollback for 0002 — Event Platform
-- NOTE: dropping event data is destructive; in production this is an ARCHIVE with governance sign-off.
DROP TABLE IF EXISTS consumer_processed;
DROP TABLE IF EXISTS consumer_subscription;
DROP TABLE IF EXISTS outcome_event_mapping;
DROP TABLE IF EXISTS event_dead_letter;
DROP TRIGGER IF EXISTS event_outbox_freeze_trg ON event_outbox;
DROP FUNCTION IF EXISTS event_outbox_freeze();
DROP TABLE IF EXISTS event_outbox;
