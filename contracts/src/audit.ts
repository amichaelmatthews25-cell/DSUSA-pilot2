/**
 * contracts/audit — canonical Audit Service interface (PMS-1 §4).
 *
 * This is the single source of truth for the Audit Service's public surface. Consumers depend on
 * THIS contract, never on the implementation. Breaking changes here require constitutional review.
 *
 * Re-exports the audit-kit shapes so the contract and the kit cannot drift.
 */
export type {
  AuditEntry,
  AuditInput,
  AuditClass,
  AuditSink,
} from "../../libs/audit-kit/src/index.ts";

import type { AuditEntry } from "../../libs/audit-kit/src/index.ts";
import type { ActorType } from "../../libs/types/src/index.ts";

/** Filter for the read-only audit query API (PMS-1 §4 queryAudit). */
export interface AuditQueryFilter {
  readonly actorType?: ActorType;
  readonly actorId?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly action?: string;
  readonly correlationId?: string;
  /** Inclusive lower bound (ISO timestamp). */
  readonly since?: string;
  /** Inclusive upper bound (ISO timestamp). */
  readonly until?: string;
  /** Pagination. */
  readonly limit?: number;
  readonly offset?: number;
}

/** The full Audit Service public interface (write + read). */
export interface AuditService {
  record(input: import("../../libs/audit-kit/src/index.ts").AuditInput, auditClass?: import("../../libs/audit-kit/src/index.ts").AuditClass): Promise<AuditEntry>;
  recordBatch(inputs: readonly import("../../libs/audit-kit/src/index.ts").AuditInput[]): Promise<readonly AuditEntry[]>;
  queryAudit(filter: AuditQueryFilter): Promise<readonly AuditEntry[]>;
  getAuditEntry(id: string): Promise<AuditEntry | null>;
}
