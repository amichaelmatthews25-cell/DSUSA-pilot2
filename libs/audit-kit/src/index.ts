/**
 * @dsusa/audit-kit — audit emission + the append-only-history pattern.
 *
 * Every component depends on this. It defines:
 *  - the AuditEntry shape (PMS-1 §5),
 *  - the AuditSink interface (components emit; the Audit Service implements),
 *  - the append-only-history helper agents reuse for domain history tables.
 *
 * audit-kit never UPDATEs or DELETEs an entry. Append-only is enforced here and at the grant level.
 */

import type {
  ActorType,
  CorrelationId,
  IdempotencyKey,
  Timestamp,
} from "../../types/src/index.ts";
import { nowTs } from "../../types/src/index.ts";

/** A single immutable audit record (mirrors PMS-1 §5 conceptual model). */
export interface AuditEntry {
  readonly id: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sourceComponent: string;
  readonly correlationId: CorrelationId;
  readonly createdAt: Timestamp;
}

/** Input to record an audit entry (id + createdAt assigned by the sink). */
export interface AuditInput {
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly sourceComponent: string;
  readonly correlationId: CorrelationId;
  /** Idempotency key so a retried audit write does not duplicate (PMS-1 §11). */
  readonly idempotencyKey: IdempotencyKey;
}

/** Audit class: transactional participates in D15 state-change tx; informational is async. */
export type AuditClass = "transactional" | "informational";

/** The sink every component writes to. The Audit Service implements this; tests use the in-memory one. */
export interface AuditSink {
  record(input: AuditInput, auditClass?: AuditClass): Promise<AuditEntry>;
  recordBatch(inputs: readonly AuditInput[]): Promise<readonly AuditEntry[]>;
}

/**
 * In-memory, append-only AuditSink for F0/tests. Idempotency-keyed; no update/delete path exists.
 */
export class InMemoryAuditSink implements AuditSink {
  private readonly entries: AuditEntry[] = [];
  private readonly byKey = new Map<string, AuditEntry>();
  private seq = 0;

  private keyFor(input: AuditInput): string {
    return `${input.sourceComponent}\u0000${input.idempotencyKey}`;
  }

  async record(input: AuditInput, auditClass: AuditClass = "informational"): Promise<AuditEntry> {
    const k = this.keyFor(input);
    const existing = this.byKey.get(k);
    if (existing) return existing; // idempotent: repeated key returns original, no duplicate.
    const entry: AuditEntry = {
      id: `audit-${++this.seq}`,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: { ...(input.metadata ?? {}), auditClass },
      sourceComponent: input.sourceComponent,
      correlationId: input.correlationId,
      createdAt: nowTs(),
    };
    this.entries.push(entry);
    this.byKey.set(k, entry);
    return entry;
  }

  async recordBatch(inputs: readonly AuditInput[]): Promise<readonly AuditEntry[]> {
    // All-or-nothing semantics: validate first, then append (no partial batch — PMS-1 §6).
    for (const i of inputs) {
      if (!i.action || !i.sourceComponent) {
        throw new Error("malformed audit input: action and sourceComponent required");
      }
    }
    const out: AuditEntry[] = [];
    for (const i of inputs) out.push(await this.record(i));
    return out;
  }

  /** Read-only query surface (deterministic order: createdAt, then id). */
  query(filter: Partial<Pick<AuditEntry, "actorType" | "actorId" | "entityType" | "entityId" | "action">>): readonly AuditEntry[] {
    return this.entries
      .filter((e) =>
        (filter.actorType === undefined || e.actorType === filter.actorType) &&
        (filter.actorId === undefined || e.actorId === filter.actorId) &&
        (filter.entityType === undefined || e.entityType === filter.entityType) &&
        (filter.entityId === undefined || e.entityId === filter.entityId) &&
        (filter.action === undefined || e.action === filter.action),
      )
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  }

  /** Total count — used by verification scripts. */
  get size(): number {
    return this.entries.length;
  }
}

/**
 * Append-only history helper (the pattern agents reuse for domain history tables, PMS-1 §5).
 * INSERT-only: no mutation of prior rows; tracks previous→new transitions with provenance.
 */
export interface HistoryRecord<S> {
  readonly entityId: string;
  readonly previous: S | null;
  readonly next: S;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly correlationId: CorrelationId;
  readonly recordedAt: Timestamp;
  /** Back-reference to the generic audit entry for cross-correlation (PMS-1 §5). */
  readonly auditEntryId: string;
}

export class AppendOnlyHistory<S> {
  private readonly rows: HistoryRecord<S>[] = [];

  append(rec: Omit<HistoryRecord<S>, "recordedAt">): HistoryRecord<S> {
    const row: HistoryRecord<S> = { ...rec, recordedAt: nowTs() };
    this.rows.push(row);
    return row;
  }

  /** History for an entity in chronological order. Never mutated. */
  forEntity(entityId: string): readonly HistoryRecord<S>[] {
    return this.rows.filter((r) => r.entityId === entityId);
  }

  get all(): readonly HistoryRecord<S>[] {
    return this.rows.slice();
  }
}
