/**
 * @dsusa/types — canonical shared value types.
 *
 * These encode constitutional rules at the type level:
 *  - Canonical entity ids are OPAQUE branded strings (no business meaning, never parsed).
 *  - actor_type is the closed enum from the Audit Service spec (PMS-1 §5).
 *  - Branding prevents an operator_id being passed where a vehicle_id is expected, etc.,
 *    which structurally discourages a component from inventing/confusing identity (D18).
 */

/** Brand helper: a nominal type over `string` so distinct id kinds are not interchangeable. */
type Brand<K, T> = K & { readonly __brand: T };

/** Canonical, permanent, opaque operator identity (owned only by the Operator Registry). */
export type OperatorId = Brand<string, "OperatorId">;
/** Canonical, permanent, opaque vehicle identity (owned only by the Vehicle Registry). */
export type VehicleId = Brand<string, "VehicleId">;
/** Canonical partner identity (owned by Partner Governance — a Domain Agent entity, not a registry). */
export type PartnerId = Brand<string, "PartnerId">;
/** Canonical load identity (owned by Freight — a Platform Asset / Domain Agent entity). */
export type LoadId = Brand<string, "LoadId">;

/** Correlation id ties a single cross-service operation together end-to-end (PMS-1 §5). */
export type CorrelationId = Brand<string, "CorrelationId">;

/** Idempotency key supplied by callers so retried writes do not duplicate (platform-wide). */
export type IdempotencyKey = Brand<string, "IdempotencyKey">;

/**
 * actor_type — closed enum, identical to Audit Service spec PMS-1 §5.
 * `ai` is included so AI activity is always distinguishable from authoritative actors.
 */
export const ACTOR_TYPES = ["agent", "service", "human", "ai", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** A caller/actor context propagated through every privileged call (auth + correlation). */
export interface ActorContext {
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly correlationId: CorrelationId;
}

/** ISO-8601 timestamp string (UTC). Stored/compared lexicographically with monotonic ordering. */
export type Timestamp = Brand<string, "Timestamp">;

// --- Constructors (the ONLY sanctioned way to mint branded values) ---

export function asOperatorId(v: string): OperatorId {
  return assertNonEmpty(v, "OperatorId") as OperatorId;
}
export function asVehicleId(v: string): VehicleId {
  return assertNonEmpty(v, "VehicleId") as VehicleId;
}
export function asPartnerId(v: string): PartnerId {
  return assertNonEmpty(v, "PartnerId") as PartnerId;
}
export function asLoadId(v: string): LoadId {
  return assertNonEmpty(v, "LoadId") as LoadId;
}
export function asCorrelationId(v: string): CorrelationId {
  return assertNonEmpty(v, "CorrelationId") as CorrelationId;
}
export function asIdempotencyKey(v: string): IdempotencyKey {
  return assertNonEmpty(v, "IdempotencyKey") as IdempotencyKey;
}
export function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}
export function asTimestamp(v: string): Timestamp {
  if (Number.isNaN(Date.parse(v))) throw new TypeError(`Invalid Timestamp: ${v}`);
  return v as Timestamp;
}

function assertNonEmpty(v: string, kind: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new TypeError(`${kind} must be a non-empty string`);
  }
  return v;
}

/** Generate an opaque, non-meaningful id (uuid-v4-shaped). Registries use this for canonical ids. */
export function newOpaqueId(): string {
  // Deterministic-first; uses crypto when available (no business meaning encoded).
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback (still opaque, no meaning).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
