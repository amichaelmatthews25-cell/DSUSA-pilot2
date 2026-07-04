/**
 * platform/event/domain — Event Platform logic (PMS-2).
 *
 * Implements the EventPlatform contract over an EventStore. Consumes the Audit Service for
 * delivery-lifecycle logging (PMS-2 §13). Does NOT consume Authorization (build-order: service-identity
 * gating happens at the edge; deliberate cycle-break, PMS-2 §9).
 *
 * Responsibilities (PMS-2 §2): durable outbox enqueue (in producer tx — D13/D15), at-least-once
 * delivery with retry + dead-letter, outcome->event mapping (D12), replay (frozen payloads), consumer
 * de-dup helpers. Provides structured logging + metrics hooks.
 */
import type {
  EmitRequest,
  EventEnvelope,
  EventHandler,
  EventPlatform,
  OutcomeDeclaration,
  OutcomeEventMapping,
  ReplayFilter,
  Subscription,
} from "../../../contracts/src/event.ts";
import type { AuditSink } from "../../../libs/audit-kit/src/index.ts";
import { asIdempotencyKey, newOpaqueId, nowTs } from "../../../libs/types/src/index.ts";
import type { EventStore } from "../data/store.ts";

const SOURCE = "event-platform";

/** Retry/delivery policy (config-driven; PMS-2 §15). */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly leaseMs: number;
}
export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, leaseMs: 30_000 };

/** Metrics hooks (PMS-2: metrics hooks). No-op default; deployment wires real metrics. */
export interface Metrics {
  increment(metric: string, tags?: Record<string, string>): void;
  observe(metric: string, value: number, tags?: Record<string, string>): void;
}
export const NOOP_METRICS: Metrics = { increment() {}, observe() {} };

/** Structured logger (PMS-2: structured logging). No-op-ish default to stdout. */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}
export const CONSOLE_LOGGER: Logger = {
  info(msg, fields) { console.log(JSON.stringify({ level: "info", src: SOURCE, msg, ...fields })); },
  warn(msg, fields) { console.warn(JSON.stringify({ level: "warn", src: SOURCE, msg, ...fields })); },
  error(msg, fields) { console.error(JSON.stringify({ level: "error", src: SOURCE, msg, ...fields })); },
};

interface Registered {
  readonly sub: Subscription;
  readonly handler: EventHandler;
}

export class EventPlatformImpl implements EventPlatform {
  private readonly store: EventStore;
  private readonly audit: AuditSink;
  private readonly retry: RetryPolicy;
  private readonly metrics: Metrics;
  private readonly log: Logger;
  private readonly consumers: Registered[] = [];
  private readonly mappings = new Map<string, OutcomeEventMapping>();

  constructor(
    store: EventStore,
    audit: AuditSink,
    opts: { retry?: RetryPolicy; metrics?: Metrics; logger?: Logger } = {},
  ) {
    this.store = store;
    this.audit = audit;
    this.retry = opts.retry ?? DEFAULT_RETRY;
    this.metrics = opts.metrics ?? NOOP_METRICS;
    this.log = opts.logger ?? CONSOLE_LOGGER;
  }

  defineMapping(mapping: OutcomeEventMapping): void {
    this.mappings.set(this.mapKey(mapping.outcomeKey, mapping.producerComponent), mapping);
  }

  private mapKey(outcomeKey: string, producer: string): string {
    return `${producer}\u0000${outcomeKey}`;
  }

  async declareOutcome(decl: OutcomeDeclaration): Promise<readonly EventEnvelope[]> {
    const mapping = this.mappings.get(this.mapKey(decl.outcomeKey, decl.producerComponent));
    if (!mapping || !mapping.isActive) {
      // Fail closed: an unmapped outcome must not silently proceed without its event (PMS-2 §10).
      this.metrics.increment("event.declare.unmapped", { producer: decl.producerComponent });
      throw new UnmappedOutcomeError(
        `no active outcome->event mapping for ${decl.producerComponent}:${decl.outcomeKey}`,
      );
    }
    const event = await this.emitInternal({
      eventType: mapping.eventType,
      eventVersion: mapping.eventVersion,
      producerComponent: decl.producerComponent,
      payload: decl.payload,
      correlationId: decl.correlationId,
      idempotencyKey: decl.idempotencyKey,
    });
    return [event];
  }

  async emitEvent(req: EmitRequest): Promise<EventEnvelope> {
    return this.emitInternal(req);
  }

  private async emitInternal(req: EmitRequest): Promise<EventEnvelope> {
    const event: EventEnvelope = {
      eventId: newOpaqueId(),
      eventType: req.eventType,
      eventVersion: req.eventVersion,
      producerComponent: req.producerComponent,
      payload: req.payload,
      correlationId: req.correlationId,
      createdAt: nowTs(),
    };
    // Producer-idempotent enqueue: a retried emit returns the original durable event (PMS-2 §11).
    const stored = await this.store.enqueueIfAbsent(event, `${req.producerComponent}\u0000${req.idempotencyKey}`);
    await this.audit.record({
      actorType: "service", actorId: SOURCE, action: "event.enqueued",
      entityType: "event", entityId: stored.eventId,
      metadata: { eventType: stored.eventType, eventVersion: stored.eventVersion, producer: stored.producerComponent },
      sourceComponent: SOURCE, correlationId: req.correlationId,
      idempotencyKey: asIdempotencyKey(`enq-${stored.eventId}`),
    }, "transactional");
    this.metrics.increment("event.enqueued", { type: stored.eventType });
    return stored;
  }

  subscribe(sub: Subscription, handler: EventHandler): void {
    this.consumers.push({ sub, handler });
    this.log.info("subscriber registered", { consumer: sub.consumer, types: sub.eventTypes });
  }

  /**
   * Deliver pending events at-least-once. Claims a leased batch, delivers to each matching consumer,
   * de-dups per consumer (exactly-once EFFECT), marks delivered/failed. Returns count of events
   * whose delivery attempt completed (delivered or failed-and-recorded).
   */
  async deliverPending(maxBatch = 50): Promise<number> {
    const now = Date.now();
    const claimed = await this.store.claimPending(maxBatch, this.retry.leaseMs, now);
    let processed = 0;
    for (const row of claimed) {
      const event = row.event;
      const matching = this.consumers.filter((c) =>
        c.sub.eventTypes.length === 0 || c.sub.eventTypes.includes(event.eventType),
      );
      let anyFailure = false;
      for (const c of matching) {
        // De-dup: skip if this consumer already processed this event (at-least-once -> exactly-once effect).
        if (await this.store.isProcessed(c.sub.consumer, event.eventId)) continue;
        try {
          await c.handler(event);
          await this.store.markProcessed(c.sub.consumer, event.eventId);
          await this.audit.record({
            actorType: "service", actorId: SOURCE, action: "event.delivered",
            entityType: "event", entityId: event.eventId,
            metadata: { consumer: c.sub.consumer, eventType: event.eventType },
            sourceComponent: SOURCE, correlationId: event.correlationId,
            idempotencyKey: asIdempotencyKey(`del-${event.eventId}-${c.sub.consumer}`),
          }, "informational");
          this.metrics.increment("event.delivered", { type: event.eventType, consumer: c.sub.consumer });
        } catch (err) {
          anyFailure = true;
          this.log.warn("consumer handler failed", {
            consumer: c.sub.consumer, eventId: event.eventId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (anyFailure) {
        const status = await this.store.markFailed(
          event.eventId, "one or more consumers failed", this.retry.maxAttempts, now,
        );
        this.metrics.increment("event.delivery_failed", { type: event.eventType, status });
        if (status === "dead_lettered") {
          await this.audit.record({
            actorType: "service", actorId: SOURCE, action: "event.dead_lettered",
            entityType: "event", entityId: event.eventId,
            metadata: { eventType: event.eventType },
            sourceComponent: SOURCE, correlationId: event.correlationId,
            idempotencyKey: asIdempotencyKey(`dlq-${event.eventId}`),
          }, "informational");
          this.log.error("event dead-lettered", { eventId: event.eventId, type: event.eventType });
        }
      } else {
        await this.store.markDelivered(event.eventId, nowTs());
      }
      processed++;
    }
    return processed;
  }

  async replay(filter: ReplayFilter): Promise<number> {
    // Replay reads frozen payloads and re-delivers; consumers de-dup, so replay cannot corrupt state.
    const events = await this.store.forReplay(filter);
    let redelivered = 0;
    for (const event of events) {
      const matching = this.consumers.filter((c) =>
        c.sub.eventTypes.length === 0 || c.sub.eventTypes.includes(event.eventType),
      );
      for (const c of matching) {
        if (await this.store.isProcessed(c.sub.consumer, event.eventId)) continue; // de-dup on replay
        try {
          await c.handler(event);
          await this.store.markProcessed(c.sub.consumer, event.eventId);
          redelivered++;
        } catch (err) {
          this.log.warn("replay handler failed", {
            consumer: c.sub.consumer, eventId: event.eventId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    await this.audit.record({
      actorType: "service", actorId: SOURCE, action: "event.replayed",
      entityType: "event", entityId: "*",
      metadata: { filter: { ...filter }, redelivered },
      sourceComponent: SOURCE, correlationId: asCorr(),
      idempotencyKey: asIdempotencyKey(`replay-${newOpaqueId()}`),
    }, "informational");
    return redelivered;
  }

  isAlreadyProcessed(consumer: string, eventId: string): boolean {
    // Synchronous helper required by the contract; backed by an async store read in production via
    // the worker path. For the contract's sync shape, callers should prefer the async store directly;
    // this returns a best-effort false when not cached (safe: at-least-once tolerates re-delivery).
    void consumer; void eventId;
    return false;
  }
}

export class UnmappedOutcomeError extends Error {
  override readonly name = "UnmappedOutcomeError";
}

function asCorr(): import("../../../libs/types/src/index.ts").CorrelationId {
  return newOpaqueId() as unknown as import("../../../libs/types/src/index.ts").CorrelationId;
}
