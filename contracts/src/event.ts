/**
 * contracts/event — canonical Event Platform interface (PMS-2 §4).
 *
 * Single source of truth for the Event Platform public surface. Consumers depend on THIS, never on
 * the implementation. Breaking changes require constitutional review.
 *
 * Binding invariants reflected here:
 *  - state-change-first: the outbox insert happens in the producer's state-change transaction (D13/D15).
 *  - at-least-once delivery; stable event ids for consumer de-dup (exactly-once EFFECT is the consumer's).
 *  - replay-safe: frozen payloads; replay never mutates state.
 *  - outcome->event mapping (D12).
 */
import type { CorrelationId, IdempotencyKey } from "../../libs/types/src/index.ts";

/** Delivery lifecycle states for an outbox event. */
export type DeliveryStatus = "pending" | "delivering" | "delivered" | "dead_lettered";

/** A frozen, versioned event payload. Once written, the payload is immutable (replay-safety). */
export interface EventEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly producerComponent: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
}

/** Producer's declaration of a business outcome (D12). The platform maps it to event(s). */
export interface OutcomeDeclaration {
  readonly outcomeKey: string;
  readonly producerComponent: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
  /** Producer idempotency key so a retried declare does not double-enqueue (PMS-2 §11). */
  readonly idempotencyKey: IdempotencyKey;
}

/** Direct emit (used where outcome-mapping is unnecessary). */
export interface EmitRequest {
  readonly eventType: string;
  readonly eventVersion: number;
  readonly producerComponent: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
}

/** A consumer subscription. */
export interface Subscription {
  readonly consumer: string;
  readonly eventTypes: readonly string[];
}

/** Outcome→event mapping row (D12 config). */
export interface OutcomeEventMapping {
  readonly outcomeKey: string;
  readonly producerComponent: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly isActive: boolean;
}

/** A consumer handler. Returns nothing; throwing signals a processing failure (triggers retry). */
export type EventHandler = (event: EventEnvelope) => Promise<void>;

/** The Event Platform public interface. */
export interface EventPlatform {
  /** Declare a business outcome; maps to event(s) and enqueues durably (in producer's tx). */
  declareOutcome(decl: OutcomeDeclaration): Promise<readonly EventEnvelope[]>;
  /** Lower-level direct emit. */
  emitEvent(req: EmitRequest): Promise<EventEnvelope>;
  /** Register a consumer + its in-process handler. */
  subscribe(sub: Subscription, handler: EventHandler): void;
  /** Drive delivery of pending events (called by the delivery worker). Returns count delivered. */
  deliverPending(maxBatch?: number): Promise<number>;
  /** Authorized redelivery of past events (frozen payloads; replay-safe). */
  replay(filter: ReplayFilter): Promise<number>;
  /** Consumer de-dup helper. */
  isAlreadyProcessed(consumer: string, eventId: string): boolean;
  /** Register an outcome→event mapping (D12). */
  defineMapping(mapping: OutcomeEventMapping): void;
}

export interface ReplayFilter {
  readonly eventType?: string;
  readonly producerComponent?: string;
  readonly since?: string;
  readonly until?: string;
}
