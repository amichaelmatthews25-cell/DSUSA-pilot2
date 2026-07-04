/**
 * platform/event/data/pg-store.ts — PRODUCTION Postgres/Supabase adapter for EventStore.
 *
 * The single production implementation of the EventStore port (in-memory exists only for tests).
 * Targets the real DSUSA stack: Postgres (Supabase) via a minimal injected SQL client so this module
 * has no driver lock-in. Operates against migration 0002 tables.
 *
 * Key production behaviors:
 *  - enqueueIfAbsent uses INSERT ... ON CONFLICT DO NOTHING on the producer-idempotency unique index
 *    (atomic, no check-then-write — D15).
 *  - claimPending uses SELECT ... FOR UPDATE SKIP LOCKED + lease, so concurrent workers never double-claim.
 *  - markFailed transitions to dead_lettered atomically when attempts exhaust.
 *  - forReplay reads frozen payloads only (never re-derives) — replay-safety.
 */
import type {
  DeliveryStatus,
  EventEnvelope,
} from "../../../contracts/src/event.ts";
import type { CorrelationId } from "../../../libs/types/src/index.ts";
import type { DeadLetterRow, EventStore, OutboxRow } from "./store.ts";

/** Minimal SQL client port (a thin wrapper over the Supabase/pg driver). Injected for testability. */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

interface OutboxDbRow {
  event_id: string;
  event_type: string;
  event_version: number;
  producer_component: string;
  payload: Record<string, unknown>;
  correlation_id: string;
  created_at: string;
  delivery_status: DeliveryStatus;
  delivery_attempts: number;
  leased_until: string | null;
  delivered_at: string | null;
}

function toEnvelope(r: OutboxDbRow): EventEnvelope {
  return {
    eventId: r.event_id,
    eventType: r.event_type,
    eventVersion: r.event_version,
    producerComponent: r.producer_component,
    payload: r.payload,
    correlationId: r.correlation_id as CorrelationId,
    createdAt: r.created_at,
  };
}

export class PostgresEventStore implements EventStore {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async enqueueIfAbsent(event: EventEnvelope, producerIdemKey: string): Promise<EventEnvelope> {
    // Atomic insert-if-absent on (producer_component, producer_idem_key).
    await this.sql.query(
      `INSERT INTO event_outbox
         (event_id, event_type, event_version, producer_component, payload,
          correlation_id, created_at, delivery_status, delivery_attempts, producer_idem_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',0,$8)
       ON CONFLICT (producer_component, producer_idem_key) DO NOTHING`,
      [
        event.eventId, event.eventType, event.eventVersion, event.producerComponent,
        JSON.stringify(event.payload), event.correlationId, event.createdAt, producerIdemKey,
      ],
    );
    // Return the durable row (existing on conflict, new otherwise).
    const { rows } = await this.sql.query<OutboxDbRow>(
      `SELECT * FROM event_outbox WHERE producer_component=$1 AND producer_idem_key=$2`,
      [event.producerComponent, producerIdemKey],
    );
    return rows[0] ? toEnvelope(rows[0]) : event;
  }

  async claimPending(max: number, leaseMs: number, now: number): Promise<OutboxRow[]> {
    const nowIso = new Date(now).toISOString();
    const leaseIso = new Date(now + leaseMs).toISOString();
    // SKIP LOCKED ensures concurrent workers claim disjoint sets; lease guards crashed workers.
    const { rows } = await this.sql.query<OutboxDbRow>(
      `WITH claimable AS (
         SELECT event_id FROM event_outbox
         WHERE delivery_status='pending'
            OR (delivery_status='delivering' AND leased_until < $1)
         ORDER BY created_at, event_id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE event_outbox o
         SET delivery_status='delivering', leased_until=$3
       FROM claimable c
       WHERE o.event_id=c.event_id
       RETURNING o.*`,
      [nowIso, max, leaseIso],
    );
    return rows.map((r) => ({
      event: toEnvelope(r),
      status: r.delivery_status,
      attempts: r.delivery_attempts,
      leasedUntil: r.leased_until ? Date.parse(r.leased_until) : null,
      deliveredAt: r.delivered_at,
    }));
  }

  async markDelivered(eventId: string, at: string): Promise<void> {
    await this.sql.query(
      `UPDATE event_outbox SET delivery_status='delivered', delivered_at=$2, leased_until=NULL
       WHERE event_id=$1`,
      [eventId, at],
    );
  }

  async markFailed(eventId: string, reason: string, maxAttempts: number, now: number): Promise<DeliveryStatus> {
    const nowIso = new Date(now).toISOString();
    const { rows } = await this.sql.query<{ delivery_status: DeliveryStatus; delivery_attempts: number }>(
      `UPDATE event_outbox
         SET delivery_attempts = delivery_attempts + 1,
             leased_until = NULL,
             delivery_status = CASE WHEN delivery_attempts + 1 >= $2 THEN 'dead_lettered' ELSE 'pending' END
       WHERE event_id=$1
       RETURNING delivery_status, delivery_attempts`,
      [eventId, maxAttempts],
    );
    const status = rows[0]?.delivery_status ?? "dead_lettered";
    if (status === "dead_lettered") {
      await this.sql.query(
        `INSERT INTO event_dead_letter (event_id, failure_reason, attempts_exhausted_at)
         VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING`,
        [eventId, reason, nowIso],
      );
    }
    return status;
  }

  async getById(eventId: string): Promise<EventEnvelope | null> {
    const { rows } = await this.sql.query<OutboxDbRow>(
      `SELECT * FROM event_outbox WHERE event_id=$1`, [eventId],
    );
    return rows[0] ? toEnvelope(rows[0]) : null;
  }

  async forReplay(filter: { eventType?: string; producerComponent?: string; since?: string; until?: string }): Promise<readonly EventEnvelope[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.eventType) { params.push(filter.eventType); clauses.push(`event_type=$${params.length}`); }
    if (filter.producerComponent) { params.push(filter.producerComponent); clauses.push(`producer_component=$${params.length}`); }
    if (filter.since) { params.push(filter.since); clauses.push(`created_at>=$${params.length}`); }
    if (filter.until) { params.push(filter.until); clauses.push(`created_at<=$${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await this.sql.query<OutboxDbRow>(
      `SELECT * FROM event_outbox ${where} ORDER BY created_at, event_id`, params,
    );
    return rows.map(toEnvelope);
  }

  async deadLetters(): Promise<readonly DeadLetterRow[]> {
    const { rows } = await this.sql.query<{ event_id: string; failure_reason: string; attempts_exhausted_at: string }>(
      `SELECT event_id, failure_reason, attempts_exhausted_at FROM event_dead_letter ORDER BY attempts_exhausted_at`,
    );
    return rows.map((r) => ({
      eventId: r.event_id,
      failureReason: r.failure_reason,
      attemptsExhaustedAt: r.attempts_exhausted_at,
    }));
  }

  async isProcessed(consumer: string, eventId: string): Promise<boolean> {
    const { rows } = await this.sql.query(
      `SELECT 1 FROM consumer_processed WHERE consumer=$1 AND event_id=$2`, [consumer, eventId],
    );
    return rows.length > 0;
  }

  async markProcessed(consumer: string, eventId: string): Promise<boolean> {
    const { rows } = await this.sql.query(
      `INSERT INTO consumer_processed (consumer, event_id, processed_at)
       VALUES ($1,$2,now()) ON CONFLICT (consumer, event_id) DO NOTHING
       RETURNING event_id`,
      [consumer, eventId],
    );
    return rows.length > 0;
  }

  async countByStatus(status: DeliveryStatus): Promise<number> {
    const { rows } = await this.sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM event_outbox WHERE delivery_status=$1`, [status],
    );
    return Number(rows[0]?.count ?? "0");
  }
}
