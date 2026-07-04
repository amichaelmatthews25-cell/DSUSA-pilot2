-- ============================================================================
-- DSUSA Migration 0002 — Event Platform (PMS-2)
-- Outbox, dead-letter, outcome->event mapping, subscriptions, consumer de-dup.
-- Consumes Audit (PMS-1) for delivery logging. No dependency on Authorization (cycle-break).
-- Forward-only; reversible via 0002_down.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_outbox (
  event_id           text PRIMARY KEY,
  event_type         text NOT NULL,
  event_version      integer NOT NULL,
  producer_component text NOT NULL,
  payload            jsonb NOT NULL,            -- FROZEN once written (replay-safety)
  correlation_id     text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  delivery_status    text NOT NULL DEFAULT 'pending'
                       CHECK (delivery_status IN ('pending','delivering','delivered','dead_lettered')),
  delivery_attempts  integer NOT NULL DEFAULT 0,
  leased_until       timestamptz,
  delivered_at       timestamptz,
  producer_idem_key  text NOT NULL
);

-- Producer idempotency: a retried emit cannot double-enqueue (PMS-2 §11).
CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_producer_idem
  ON event_outbox (producer_component, producer_idem_key);

-- Delivery worker scan path (claim pending, ordered).
CREATE INDEX IF NOT EXISTS event_outbox_pending
  ON event_outbox (delivery_status, created_at, event_id);
CREATE INDEX IF NOT EXISTS event_outbox_type ON event_outbox (event_type, created_at);

-- Frozen payload enforcement: block UPDATE of payload/identity columns (replay-safety).
CREATE OR REPLACE FUNCTION event_outbox_freeze() RETURNS trigger AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.event_version IS DISTINCT FROM OLD.event_version
     OR NEW.producer_component IS DISTINCT FROM OLD.producer_component
     OR NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'event_outbox payload/identity is frozen (PMS-2 replay-safety)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_outbox_freeze_trg ON event_outbox;
CREATE TRIGGER event_outbox_freeze_trg
  BEFORE UPDATE ON event_outbox
  FOR EACH ROW EXECUTE FUNCTION event_outbox_freeze();

CREATE TABLE IF NOT EXISTS event_dead_letter (
  event_id             text PRIMARY KEY REFERENCES event_outbox(event_id),
  failure_reason       text NOT NULL,
  attempts_exhausted_at timestamptz NOT NULL,
  resolution           text,
  resolved_by          text,
  resolved_at          timestamptz
);

CREATE TABLE IF NOT EXISTS outcome_event_mapping (
  outcome_key        text NOT NULL,
  producer_component text NOT NULL,
  event_type         text NOT NULL,
  event_version      integer NOT NULL,
  routing            jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active          boolean NOT NULL DEFAULT true,
  PRIMARY KEY (producer_component, outcome_key)
);

CREATE TABLE IF NOT EXISTS consumer_subscription (
  consumer    text NOT NULL,
  event_type  text NOT NULL,
  endpoint    text,
  active      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (consumer, event_type)
);

-- Consumer de-dup: turns at-least-once delivery into exactly-once effect (PMS-2 §11).
CREATE TABLE IF NOT EXISTS consumer_processed (
  consumer     text NOT NULL,
  event_id     text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
