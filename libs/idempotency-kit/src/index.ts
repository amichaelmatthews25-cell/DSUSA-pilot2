/**
 * @dsusa/idempotency-kit — platform-wide idempotency + de-dup helpers.
 *
 * Used by every component that accepts writes (Audit, Event producers/consumers, Notification,
 * Scheduler, Registries, agents). Implements the "repeated key returns the original result,
 * no duplicate effect" guarantee. Keys are scoped by component to avoid cross-component collision.
 */

import type { IdempotencyKey } from "../../types/src/index.ts";

/** A stored idempotent outcome keyed by (scope, key). */
interface Stored<T> {
  readonly value: T;
}

/**
 * Idempotency store interface. F0 ships an in-memory implementation; deployment backs it
 * with a unique (scope, key) constraint in the owning component's database.
 */
export interface IdempotencyStore<T> {
  get(scope: string, key: IdempotencyKey): Promise<T | undefined>;
  /** Atomically store-if-absent. Returns the winning value (existing if present, else `value`). */
  putIfAbsent(scope: string, key: IdempotencyKey, value: T): Promise<T>;
}

/** In-memory idempotency store (F0 / tests). Atomic by single-threaded Map semantics. */
export class InMemoryIdempotencyStore<T> implements IdempotencyStore<T> {
  private readonly map = new Map<string, Stored<T>>();

  private composite(scope: string, key: IdempotencyKey): string {
    return `${scope}\u0000${key}`;
  }

  async get(scope: string, key: IdempotencyKey): Promise<T | undefined> {
    return this.map.get(this.composite(scope, key))?.value;
  }

  async putIfAbsent(scope: string, key: IdempotencyKey, value: T): Promise<T> {
    const k = this.composite(scope, key);
    const existing = this.map.get(k);
    if (existing) return existing.value;
    this.map.set(k, { value });
    return value;
  }
}

/**
 * Run `op` at most once per (scope, key). On a repeat key, returns the original result and does
 * NOT execute `op` again. This is the canonical platform idempotency wrapper.
 */
export async function idempotent<T>(
  store: IdempotencyStore<T>,
  scope: string,
  key: IdempotencyKey,
  op: () => Promise<T>,
): Promise<T> {
  const existing = await store.get(scope, key);
  if (existing !== undefined) return existing;
  const produced = await op();
  // putIfAbsent makes concurrent callers converge on a single stored result.
  return store.putIfAbsent(scope, key, produced);
}

/**
 * Consumer-side de-dup: has (consumer, eventId) been processed already? Backs the Event Platform
 * consumer de-dup helper (PMS-2) to turn at-least-once delivery into exactly-once effect.
 */
export class ProcessedSet {
  private readonly seen = new Set<string>();
  private composite(consumer: string, eventId: string): string {
    return `${consumer}\u0000${eventId}`;
  }
  isAlreadyProcessed(consumer: string, eventId: string): boolean {
    return this.seen.has(this.composite(consumer, eventId));
  }
  /** Mark processed. Returns false if it was already processed (caller should skip side effects). */
  markProcessed(consumer: string, eventId: string): boolean {
    const k = this.composite(consumer, eventId);
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
}
