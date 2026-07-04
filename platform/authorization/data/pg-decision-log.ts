/**
 * platform/authorization/data/pg-decision-log.ts — PRODUCTION decision-log adapter.
 *
 * The single production implementation of DecisionLogStore. Writes the append-only decision RECORD to
 * `authorization_decision_log` (migration 0003), where UPDATE/DELETE are revoked at the grant level.
 *
 * It stores the producing-facts snapshot so a decision is reproducible. It is NEVER read during
 * isAuthorized() — only for audit/reproduction. There is no subject-keyed "latest decision" read,
 * structurally preventing use as an enforcement cache.
 */
import type { AuthorizationDecision, AuthorityFact } from "../../../contracts/src/authorization.ts";
import type { CorrelationId } from "../../../libs/types/src/index.ts";
import type { DecisionLogStore } from "./decision-log.ts";
import type { SqlClient } from "../../event/data/pg-store.ts";

interface DecisionDbRow {
  decision_id: string;
  allowed: boolean;
  capability: string;
  subject_id: string;
  actor_type: string;
  actor_id: string;
  decided_at: string;
  correlation_id: string;
  composed_facts_snapshot: Record<string, AuthorityFact>;
  producing_services: string[];
  rules_version: number;
  explanation: string;
  audit_ref: string;
  reasons: string[];
}

export class PostgresDecisionLog implements DecisionLogStore {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async append(d: AuthorizationDecision): Promise<AuthorizationDecision> {
    await this.sql.query(
      `INSERT INTO authorization_decision_log
         (decision_id, allowed, capability, subject_id, actor_type, actor_id, decided_at,
          correlation_id, composed_facts_snapshot, producing_services, rules_version,
          explanation, audit_ref, reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        d.decisionId, d.allowed, d.capability, d.subjectId, d.actorType, d.actorId, d.timestamp,
        d.correlationId, JSON.stringify(d.producingFacts), JSON.stringify(d.producingServices),
        d.rulesVersion, d.explanation, d.auditRef, JSON.stringify(d.reasons),
      ],
    );
    return d;
  }

  async getForAudit(decisionId: string): Promise<AuthorizationDecision | null> {
    const { rows } = await this.sql.query<DecisionDbRow>(
      `SELECT * FROM authorization_decision_log WHERE decision_id=$1`, [decisionId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      decisionId: r.decision_id,
      allowed: r.allowed,
      capability: r.capability,
      subjectId: r.subject_id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      timestamp: r.decided_at,
      correlationId: r.correlation_id as CorrelationId,
      producingFacts: r.composed_facts_snapshot,
      producingServices: r.producing_services,
      rulesVersion: r.rules_version,
      explanation: r.explanation,
      auditRef: r.audit_ref,
      reasons: r.reasons,
    };
  }

  async count(): Promise<number> {
    const { rows } = await this.sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM authorization_decision_log`,
    );
    return Number(rows[0]?.count ?? "0");
  }
}
