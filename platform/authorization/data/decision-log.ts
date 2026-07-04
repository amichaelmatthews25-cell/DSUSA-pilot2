/**
 * platform/authorization/data — the ONLY persistence the Authorization Service has.
 *
 * CONSTITUTIONAL: this is a decision LOG (an append-only record for reproducibility/audit), NOT a
 * store of authority. There is deliberately:
 *   - NO standing table,
 *   - NO eligibility table,
 *   - NO enforcement cache,
 *   - NO method to READ a prior decision to make a NEW one (decisions never feed enforcement).
 *
 * The log exists so a past decision can be reproduced from its recorded facts. It is never consulted
 * during isAuthorized(). The port exposes append + read-for-audit only.
 */
import type { AuthorizationDecision } from "../../../contracts/src/authorization.ts";

export interface DecisionLogStore {
  /** Append a decision record (idempotent by decisionId). Returns the stored record. */
  append(decision: AuthorizationDecision): Promise<AuthorizationDecision>;
  /** Read a recorded decision by id — for AUDIT/reproduction only, never for enforcement. */
  getForAudit(decisionId: string): Promise<AuthorizationDecision | null>;
  /** Count — verification/metrics only. */
  count(): Promise<number>;
}

/**
 * In-memory decision log (TEST ONLY). The production adapter (pg-decision-log.ts) writes the same
 * append-only record to `authorization_decision_log` (migration 0003), where UPDATE/DELETE are revoked.
 *
 * NOTE: There is intentionally no "getLatestDecisionFor(subject)" or any read keyed by subject —
 * that would invite using a stored decision as an enforcement cache, which is prohibited.
 */
export class InMemoryDecisionLog implements DecisionLogStore {
  private readonly byId = new Map<string, AuthorizationDecision>();

  async append(decision: AuthorizationDecision): Promise<AuthorizationDecision> {
    const existing = this.byId.get(decision.decisionId);
    if (existing) return existing; // idempotent
    this.byId.set(decision.decisionId, decision);
    return decision;
  }

  async getForAudit(decisionId: string): Promise<AuthorizationDecision | null> {
    return this.byId.get(decisionId) ?? null;
  }

  async count(): Promise<number> {
    return this.byId.size;
  }
}
