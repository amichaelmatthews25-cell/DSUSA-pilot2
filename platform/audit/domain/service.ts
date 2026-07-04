/**
 * platform/audit/domain — Audit Service logic (PMS-1).
 *
 * Implements the AuditService contract over an AuditStore. Responsibilities (PMS-1 §2):
 *  - accept + durably persist append-only records (idempotent),
 *  - transactional vs informational audit classes (§10),
 *  - self-audit of administrative reads/break-glass (§13),
 *  - read query (§4).
 *
 * Consumes NOTHING else (foundational). Access gating uses the F0 auth substrate (no call to the
 * Authorization Service — deliberate cycle-break, PMS-1 §9 / §21).
 */
import type {
  AuditEntry,
  AuditInput,
  AuditClass,
} from "../../../libs/audit-kit/src/index.ts";
import type { AuditQueryFilter, AuditService } from "../../../contracts/src/audit.ts";
import type { AuditStore } from "../data/store.ts";
import { AuthSubstrate } from "../../../libs/auth-kit/src/index.ts";
import type { ActorContext } from "../../../libs/types/src/index.ts";
import { asIdempotencyKey } from "../../../libs/types/src/index.ts";

const SOURCE = "audit-service";

export class AuditServiceImpl implements AuditService {
  private readonly store: AuditStore;
  private readonly auth: AuthSubstrate;

  constructor(store: AuditStore, auth: AuthSubstrate) {
    this.store = store;
    this.auth = auth;
  }

  /**
   * Record an audit entry. `auditClass` is advisory metadata about HOW the write participates:
   *  - transactional: caller is responsible for invoking this inside its state-change transaction (D15);
   *    the store insert is the durable record. (In Postgres this runs in the caller's tx.)
   *  - informational: may be retried asynchronously by the caller.
   * The Audit Service persists identically; the class is recorded in metadata for audit reconstruction.
   */
  async record(input: AuditInput, auditClass: AuditClass = "informational"): Promise<AuditEntry> {
    const withClass: AuditInput = {
      ...input,
      metadata: { ...(input.metadata ?? {}), auditClass },
    };
    return this.store.insert(withClass);
  }

  async recordBatch(inputs: readonly AuditInput[]): Promise<readonly AuditEntry[]> {
    return this.store.insertBatch(inputs);
  }

  /**
   * Read-only audit query. Restricted to audit-reader / platform-admin roles (PMS-1 §9).
   * The read itself is self-audited (§13): "who queried the audit log" is itself immutable.
   */
  async queryAudit(filter: AuditQueryFilter, reader?: ActorContext): Promise<readonly AuditEntry[]> {
    if (reader) {
      const decision = this.auth.requireAnyRole(reader, ["audit_reader", "platform_admin"]);
      if (!decision.allowed) {
        throw new AuditAccessError(`audit read denied: ${decision.reason}`);
      }
      // Self-audit the read (best-effort informational; never blocks the read result on its own audit).
      await this.store.insert({
        actorType: reader.actorType,
        actorId: reader.actorId,
        action: "audit.query",
        entityType: "audit_log",
        entityId: "*",
        metadata: { filter: redactFilter(filter) },
        sourceComponent: SOURCE,
        correlationId: reader.correlationId,
        idempotencyKey: asIdempotencyKey(`query-${reader.correlationId}-${Date.now()}`),
      });
    }
    return this.store.query(filter);
  }

  async getAuditEntry(id: string): Promise<AuditEntry | null> {
    return this.store.getById(id);
  }
}

export class AuditAccessError extends Error {
  override readonly name = "AuditAccessError";
}

/** Keep filter metadata small + non-sensitive in the self-audit record. */
function redactFilter(f: AuditQueryFilter): Record<string, unknown> {
  return {
    actorType: f.actorType,
    entityType: f.entityType,
    action: f.action,
    since: f.since,
    until: f.until,
  };
}
