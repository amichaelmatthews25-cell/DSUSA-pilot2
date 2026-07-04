/**
 * platform/audit/data — persistence for the Audit Service.
 *
 * Defines the AuditStore port (owned ONLY by the Audit Service — single-ownership) and an in-memory
 * adapter used for tests/F-stage running. The Postgres adapter (deployment) implements the same port
 * against the append-only `audit_entry` table from migration 0001, where UPDATE/DELETE are revoked.
 *
 * The store is append-only by construction: no update/delete method exists on the port.
 */
import type {
  AuditEntry,
  AuditInput,
} from "../../../libs/audit-kit/src/index.ts";
import type { AuditQueryFilter } from "../../../contracts/src/audit.ts";
import { nowTs } from "../../../libs/types/src/index.ts";

export interface AuditStore {
  /** Insert-if-absent by (sourceComponent, idempotencyKey). Returns the stored entry (original on repeat). */
  insert(input: AuditInput): Promise<AuditEntry>;
  /** Batch insert, all-or-nothing (validation before any write). */
  insertBatch(inputs: readonly AuditInput[]): Promise<readonly AuditEntry[]>;
  /** Read-only query, deterministic order (created_at, id). */
  query(filter: AuditQueryFilter): Promise<readonly AuditEntry[]>;
  getById(id: string): Promise<AuditEntry | null>;
}

/** In-memory append-only store (F-stage / tests). Mirrors the SQL append-only guarantees. */
export class InMemoryAuditStore implements AuditStore {
  private readonly rows: AuditEntry[] = [];
  private readonly byKey = new Map<string, AuditEntry>();
  private readonly byId = new Map<string, AuditEntry>();
  private seq = 0;

  private key(input: AuditInput): string {
    return `${input.sourceComponent}\u0000${input.idempotencyKey}`;
  }

  async insert(input: AuditInput): Promise<AuditEntry> {
    if (!input.action || !input.sourceComponent) {
      throw new Error("malformed audit input: action and sourceComponent required");
    }
    const k = this.key(input);
    const existing = this.byKey.get(k);
    if (existing) return existing; // idempotent (PMS-1 §11)
    const entry: AuditEntry = {
      id: `audit-${++this.seq}`,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
      sourceComponent: input.sourceComponent,
      correlationId: input.correlationId,
      createdAt: nowTs(),
    };
    this.rows.push(entry);
    this.byKey.set(k, entry);
    this.byId.set(entry.id, entry);
    return entry;
  }

  async insertBatch(inputs: readonly AuditInput[]): Promise<readonly AuditEntry[]> {
    for (const i of inputs) {
      if (!i.action || !i.sourceComponent) {
        throw new Error("malformed audit input in batch: action and sourceComponent required");
      }
    }
    const out: AuditEntry[] = [];
    for (const i of inputs) out.push(await this.insert(i));
    return out;
  }

  async query(filter: AuditQueryFilter): Promise<readonly AuditEntry[]> {
    let res = this.rows.filter((e) =>
      (filter.actorType === undefined || e.actorType === filter.actorType) &&
      (filter.actorId === undefined || e.actorId === filter.actorId) &&
      (filter.entityType === undefined || e.entityType === filter.entityType) &&
      (filter.entityId === undefined || e.entityId === filter.entityId) &&
      (filter.action === undefined || e.action === filter.action) &&
      (filter.correlationId === undefined || e.correlationId === filter.correlationId) &&
      (filter.since === undefined || e.createdAt >= filter.since) &&
      (filter.until === undefined || e.createdAt <= filter.until),
    );
    res = res.slice().sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
    );
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? res.length;
    return res.slice(offset, offset + limit);
  }

  async getById(id: string): Promise<AuditEntry | null> {
    return this.byId.get(id) ?? null;
  }
}
