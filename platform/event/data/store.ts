/**
 * platform/event/data — persistence ports for the Event Platform.
 *
 * Defines the EventStore port (outbox + dead-letter + consumer-processed). The in-memory adapter here
 * is for tests; the Postgres adapter (data/pg-store.ts) implements the SAME port against migration 0002.
 * Single-ownership: only the Event Platform touches these tables.
 *
 * Lease-based claim prevents two delivery workers from delivering the same event (PMS-2 §12).
 */
import type {
  DeliveryStatus,
  EventEnvelope,
} from "../../../contracts/src/event.ts";

export interface OutboxRow {
  readonly event: EventEnvelope;
  status: DeliveryStatus;
  attempts: number;
  leasedUntil: number | null;
  deliveredAt: string | null;
}

export interface DeadLetterRow {
  readonly eventId: string;
  readonly failureReason: string;
  readonly attemptsExhaustedAt: string;
}

export interface EventStore {
  /** Insert an event into the outbox if its (producer, idempotencyKey) is new; returns the stored event. */
  enqueueIfAbsent(event: EventEnvelope, producerIdemKey: string): Promise<EventEnvelope>;
  /** Claim up to `max` pending events with a lease (atomic). Returns claimed rows. */
  claimPending(max: number, leaseMs: number, now: number): Promise<OutboxRow[]>;
  markDelivered(eventId: string, at: string): Promise<void>;
  /** Increment attempts; if exhausted, move to dead-letter. Returns the new status. */
  markFailed(eventId: string, reason: string, maxAttempts: number, now: number): Promise<DeliveryStatus>;
  getById(eventId: string): Promise<EventEnvelope | null>;
  /** Read events for replay (frozen payloads). */
  forReplay(filter: { eventType?: string; producerComponent?: string; since?: string; until?: string }): Promise<readonly EventEnvelope[]>;
  deadLetters(): Promise<readonly DeadLetterRow[]>;
  /** Consumer de-dup: has (consumer, eventId) been processed? */
  isProcessed(consumer: string, eventId: string): Promise<boolean>;
  markProcessed(consumer: string, eventId: string): Promise<boolean>;
  /** Test/metrics support. */
  countByStatus(status: DeliveryStatus): Promise<number>;
}

export class InMemoryEventStore implements EventStore {
  private readonly outbox = new Map<string, OutboxRow>();
  private readonly idem = new Map<string, string>(); // producerIdemKey -> eventId
  private readonly dlq: DeadLetterRow[] = [];
  private readonly processed = new Set<string>();

  async enqueueIfAbsent(event: EventEnvelope, producerIdemKey: string): Promise<EventEnvelope> {
    const existingId = this.idem.get(producerIdemKey);
    if (existingId) {
      return this.outbox.get(existingId)!.event;
    }
    this.outbox.set(event.eventId, {
      event,
      status: "pending",
      attempts: 0,
      leasedUntil: null,
      deliveredAt: null,
    });
    this.idem.set(producerIdemKey, event.eventId);
    return event;
  }

  async claimPending(max: number, leaseMs: number, now: number): Promise<OutboxRow[]> {
    const claimed: OutboxRow[] = [];
    for (const row of this.outbox.values()) {
      if (claimed.length >= max) break;
      const available =
        row.status === "pending" ||
        (row.status === "delivering" && row.leasedUntil !== null && row.leasedUntil < now);
      if (available) {
        row.status = "delivering";
        row.leasedUntil = now + leaseMs;
        claimed.push(row);
      }
    }
    return claimed;
  }

  async markDelivered(eventId: string, at: string): Promise<void> {
    const row = this.outbox.get(eventId);
    if (row) {
      row.status = "delivered";
      row.deliveredAt = at;
      row.leasedUntil = null;
    }
  }

  async markFailed(eventId: string, reason: string, maxAttempts: number, now: number): Promise<DeliveryStatus> {
    const row = this.outbox.get(eventId);
    if (!row) return "dead_lettered";
    row.attempts += 1;
    row.leasedUntil = null;
    if (row.attempts >= maxAttempts) {
      row.status = "dead_lettered";
      this.dlq.push({
        eventId,
        failureReason: reason,
        attemptsExhaustedAt: new Date(now).toISOString(),
      });
    } else {
      row.status = "pending"; // retry later
    }
    return row.status;
  }

  async getById(eventId: string): Promise<EventEnvelope | null> {
    return this.outbox.get(eventId)?.event ?? null;
  }

  async forReplay(filter: { eventType?: string; producerComponent?: string; since?: string; until?: string }): Promise<readonly EventEnvelope[]> {
    return [...this.outbox.values()]
      .map((r) => r.event)
      .filter((e) =>
        (filter.eventType === undefined || e.eventType === filter.eventType) &&
        (filter.producerComponent === undefined || e.producerComponent === filter.producerComponent) &&
        (filter.since === undefined || e.createdAt >= filter.since) &&
        (filter.until === undefined || e.createdAt <= filter.until),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.eventId < b.eventId ? -1 : 1));
  }

  async deadLetters(): Promise<readonly DeadLetterRow[]> {
    return this.dlq.slice();
  }

  private pkey(consumer: string, eventId: string): string {
    return `${consumer}\u0000${eventId}`;
  }
  async isProcessed(consumer: string, eventId: string): Promise<boolean> {
    return this.processed.has(this.pkey(consumer, eventId));
  }
  async markProcessed(consumer: string, eventId: string): Promise<boolean> {
    const k = this.pkey(consumer, eventId);
    if (this.processed.has(k)) return false;
    this.processed.add(k);
    return true;
  }

  async countByStatus(status: DeliveryStatus): Promise<number> {
    let n = 0;
    for (const r of this.outbox.values()) if (r.status === status) n++;
    return n;
  }
}
