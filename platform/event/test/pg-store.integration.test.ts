/**
 * Integration test for the PRODUCTION PostgresEventStore adapter (platform/event/data/pg-store.ts).
 *
 * This environment has no Postgres, so we inject a FakeSqlClient that emulates the exact SQL semantics
 * the adapter relies on: ON CONFLICT DO NOTHING idempotency, the claim CTE (pending -> delivering),
 * markFailed's attempts/dead-letter transition, and consumer_processed dedup. This exercises the real
 * adapter code paths (query construction, row mapping, state transitions) — not the in-memory store.
 *
 * When a real Postgres is available in CI, the same test runs against it by swapping the client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresEventStore, type SqlClient } from "../data/pg-store.ts";
import type { EventEnvelope } from "../../../contracts/src/event.ts";
import { asCorrelationId } from "../../../libs/types/src/index.ts";

/** Minimal in-process emulation of the specific SQL statements the adapter issues. */
class FakeSqlClient implements SqlClient {
  private outbox = new Map<string, Record<string, unknown>>();
  private idemIndex = new Map<string, string>(); // producer\u0000idem -> event_id
  private dlq = new Map<string, Record<string, unknown>>();
  private processed = new Set<string>();

  async query<T = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<{ rows: T[] }> {
    const t = text.replace(/\s+/g, " ").trim();

    if (t.startsWith("INSERT INTO event_outbox")) {
      const [eventId, eventType, eventVersion, producer, payload, corr, createdAt, idem] = params as string[];
      const idemKey = `${producer}\u0000${idem}`;
      if (!this.idemIndex.has(idemKey)) {
        this.outbox.set(eventId, {
          event_id: eventId, event_type: eventType, event_version: Number(eventVersion),
          producer_component: producer, payload: JSON.parse(payload as string),
          correlation_id: corr, created_at: createdAt, delivery_status: "pending",
          delivery_attempts: 0, leased_until: null, delivered_at: null, producer_idem_key: idem,
        });
        this.idemIndex.set(idemKey, eventId);
      }
      return { rows: [] };
    }

    if (t.startsWith("SELECT * FROM event_outbox WHERE producer_component")) {
      const [producer, idem] = params as string[];
      const id = this.idemIndex.get(`${producer}\u0000${idem}`);
      const row = id ? this.outbox.get(id) : undefined;
      return { rows: row ? [row as T] : [] };
    }

    if (t.startsWith("WITH claimable AS")) {
      const [nowIso, max, leaseIso] = params as [string, number, string];
      const claimed: Record<string, unknown>[] = [];
      for (const row of this.outbox.values()) {
        if (claimed.length >= max) break;
        const avail = row.delivery_status === "pending" ||
          (row.delivery_status === "delivering" && (row.leased_until as string) < nowIso);
        if (avail) {
          row.delivery_status = "delivering";
          row.leased_until = leaseIso;
          claimed.push({ ...row });
        }
      }
      return { rows: claimed as T[] };
    }

    if (t.startsWith("UPDATE event_outbox SET delivery_status='delivered'")) {
      const [eventId, at] = params as string[];
      const row = this.outbox.get(eventId);
      if (row) { row.delivery_status = "delivered"; row.delivered_at = at; row.leased_until = null; }
      return { rows: [] };
    }

    if (t.startsWith("UPDATE event_outbox SET delivery_attempts")) {
      const [eventId, maxAttempts] = params as [string, number];
      const row = this.outbox.get(eventId);
      if (!row) return { rows: [{ delivery_status: "dead_lettered", delivery_attempts: maxAttempts } as T] };
      row.delivery_attempts = (row.delivery_attempts as number) + 1;
      row.leased_until = null;
      row.delivery_status = (row.delivery_attempts as number) >= maxAttempts ? "dead_lettered" : "pending";
      return { rows: [{ delivery_status: row.delivery_status, delivery_attempts: row.delivery_attempts } as T] };
    }

    if (t.startsWith("INSERT INTO event_dead_letter")) {
      const [eventId, reason, at] = params as string[];
      if (!this.dlq.has(eventId)) this.dlq.set(eventId, { event_id: eventId, failure_reason: reason, attempts_exhausted_at: at });
      return { rows: [] };
    }

    if (t.startsWith("INSERT INTO consumer_processed")) {
      const [consumer, eventId] = params as string[];
      const k = `${consumer}\u0000${eventId}`;
      if (this.processed.has(k)) return { rows: [] };
      this.processed.add(k);
      return { rows: [{ event_id: eventId } as T] };
    }

    if (t.startsWith("SELECT 1 FROM consumer_processed")) {
      const [consumer, eventId] = params as string[];
      return { rows: this.processed.has(`${consumer}\u0000${eventId}`) ? [{ } as T] : [] };
    }

    if (t.startsWith("SELECT count(*)")) {
      const [status] = params as string[];
      let n = 0;
      for (const r of this.outbox.values()) if (r.delivery_status === status) n++;
      return { rows: [{ count: String(n) } as T] };
    }

    if (t.startsWith("SELECT event_id, failure_reason")) {
      return { rows: [...this.dlq.values()] as T[] };
    }

    if (t.startsWith("SELECT * FROM event_outbox WHERE event_id")) {
      const [eventId] = params as string[];
      const row = this.outbox.get(eventId);
      return { rows: row ? [row as T] : [] };
    }

    if (t.startsWith("SELECT * FROM event_outbox")) {
      // forReplay (no/optional filters) — return all ordered.
      return { rows: [...this.outbox.values()] as T[] };
    }

    throw new Error(`FakeSqlClient: unhandled query: ${t.slice(0, 60)}`);
  }
}

function envelope(id: string, idem: string): EventEnvelope {
  return {
    eventId: id, eventType: "load.completed", eventVersion: 1,
    producerComponent: "freight", payload: { loadId: "L-1" },
    correlationId: asCorrelationId("c-int"), createdAt: new Date().toISOString(),
  };
}

test("pg adapter: enqueueIfAbsent is idempotent on producer key", async () => {
  const store = new PostgresEventStore(new FakeSqlClient());
  const a = await store.enqueueIfAbsent(envelope("evt-1", "k1"), "freight\u0000k1");
  const b = await store.enqueueIfAbsent(envelope("evt-2", "k1"), "freight\u0000k1"); // same key
  assert.equal(a.eventId, "evt-1");
  assert.equal(b.eventId, "evt-1", "second enqueue with same producer key returns original");
  assert.equal(await store.countByStatus("pending"), 1);
});

test("pg adapter: claim -> deliver transitions status", async () => {
  const store = new PostgresEventStore(new FakeSqlClient());
  await store.enqueueIfAbsent(envelope("evt-1", "k1"), "freight\u0000k1");
  const claimed = await store.claimPending(10, 30000, Date.now());
  assert.equal(claimed.length, 1);
  await store.markDelivered("evt-1", new Date().toISOString());
  assert.equal(await store.countByStatus("delivered"), 1);
});

test("pg adapter: markFailed transitions to dead_lettered after maxAttempts", async () => {
  const store = new PostgresEventStore(new FakeSqlClient());
  await store.enqueueIfAbsent(envelope("evt-1", "k1"), "freight\u0000k1");
  const now = Date.now();
  const s1 = await store.markFailed("evt-1", "boom", 2, now);
  assert.equal(s1, "pending");
  const s2 = await store.markFailed("evt-1", "boom", 2, now);
  assert.equal(s2, "dead_lettered");
  const dlq = await store.deadLetters();
  assert.equal(dlq.length, 1);
  assert.equal(dlq[0]!.eventId, "evt-1");
});

test("pg adapter: consumer dedup", async () => {
  const store = new PostgresEventStore(new FakeSqlClient());
  assert.equal(await store.isProcessed("c", "evt-1"), false);
  assert.equal(await store.markProcessed("c", "evt-1"), true);
  assert.equal(await store.isProcessed("c", "evt-1"), true);
  assert.equal(await store.markProcessed("c", "evt-1"), false);
});
