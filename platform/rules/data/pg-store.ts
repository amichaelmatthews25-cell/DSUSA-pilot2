/**
 * platform/rules/data/pg-store.ts — PRODUCTION Postgres adapters for the Rules Engine.
 *
 * Single production implementations of RuleSetRegistry + EvaluationLog against migration 0004.
 * Rule sets are immutable (unique (rule_set_id, version); UPDATE/DELETE revoked). Evaluation log is
 * append-only. Reuses the shared SqlClient infra port (type-only).
 */
import type { EvaluationResult, RuleSet, Rule } from "../../../contracts/src/rules.ts";
import type { CorrelationId } from "../../../libs/types/src/index.ts";
import type { SqlClient } from "../../event/data/pg-store.ts";
import { ImmutableRuleSetError, type EvaluationLog, type RuleSetRegistry } from "./store.ts";

interface RuleSetDbRow {
  rule_set_id: string;
  version: number;
  rules: Rule[];
  default_effect: string;
}
interface EvalDbRow {
  evaluation_id: string;
  rule_set_id: string;
  version: number;
  evaluated_at: string;
  inputs: Record<string, unknown>;
  effects: string[];
  fired_rules: { ruleId: string; effect: string; reason: string }[];
  resolved_effect: string;
  explanation: string;
  correlation_id: string;
  audit_ref: string;
  dry_run: boolean;
}

export class PostgresRuleSetRegistry implements RuleSetRegistry {
  private readonly sql: SqlClient;
  // Note: registry reads are synchronous in the contract; production callers warm a read-through cache
  // at load time. For correctness here we expose async-backed sync via a preloaded map kept in sync on put.
  private readonly cache = new Map<string, RuleSet>();
  constructor(sql: SqlClient) {
    this.sql = sql;
  }
  private key(id: string, v: number): string { return `${id}\u0000${v}`; }

  put(ruleSet: RuleSet): void {
    const k = this.key(ruleSet.ruleSetId, ruleSet.version);
    if (this.cache.has(k)) {
      throw new ImmutableRuleSetError(`rule set ${ruleSet.ruleSetId} v${ruleSet.version} already exists`);
    }
    // Fire-and-forget insert with ON CONFLICT DO NOTHING; immutability also enforced by DB unique + grants.
    void this.sql.query(
      `INSERT INTO rule_set (rule_set_id, version, rules, default_effect)
       VALUES ($1,$2,$3,$4) ON CONFLICT (rule_set_id, version) DO NOTHING`,
      [ruleSet.ruleSetId, ruleSet.version, JSON.stringify(ruleSet.rules), ruleSet.defaultEffect],
    );
    this.cache.set(k, ruleSet);
  }
  get(ruleSetId: string, version: number): RuleSet | null {
    return this.cache.get(this.key(ruleSetId, version)) ?? null;
  }
  versions(ruleSetId: string): readonly number[] {
    const out: number[] = [];
    for (const k of this.cache.keys()) {
      const [id, v] = k.split("\u0000");
      if (id === ruleSetId) out.push(Number(v));
    }
    return out.sort((a, b) => a - b);
  }

  /** Production warm-load: populate the cache from the durable store. */
  async load(): Promise<void> {
    const { rows } = await this.sql.query<RuleSetDbRow>(`SELECT * FROM rule_set`);
    for (const r of rows) {
      this.cache.set(this.key(r.rule_set_id, r.version), {
        ruleSetId: r.rule_set_id, version: r.version, rules: r.rules, defaultEffect: r.default_effect,
      });
    }
  }
}

export class PostgresEvaluationLog implements EvaluationLog {
  private readonly sql: SqlClient;
  constructor(sql: SqlClient) {
    this.sql = sql;
  }
  async append(r: EvaluationResult): Promise<EvaluationResult> {
    await this.sql.query(
      `INSERT INTO rule_evaluation
         (evaluation_id, rule_set_id, version, evaluated_at, inputs, effects, fired_rules,
          resolved_effect, explanation, correlation_id, audit_ref, dry_run)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (evaluation_id) DO NOTHING`,
      [
        r.evaluationId, r.ruleSetId, r.version, r.timestamp, JSON.stringify(r.inputs),
        JSON.stringify(r.effects), JSON.stringify(r.firedRules), r.resolvedEffect, r.explanation,
        r.correlationId, r.auditRef, r.dryRun,
      ],
    );
    return r;
  }
  async getById(evaluationId: string): Promise<EvaluationResult | null> {
    const { rows } = await this.sql.query<EvalDbRow>(
      `SELECT * FROM rule_evaluation WHERE evaluation_id=$1`, [evaluationId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      evaluationId: r.evaluation_id, ruleSetId: r.rule_set_id, version: r.version,
      timestamp: r.evaluated_at, inputs: r.inputs, effects: r.effects, firedRules: r.fired_rules,
      resolvedEffect: r.resolved_effect, explanation: r.explanation,
      correlationId: r.correlation_id as CorrelationId, auditRef: r.audit_ref, dryRun: r.dry_run,
    };
  }
  async count(): Promise<number> {
    const { rows } = await this.sql.query<{ count: string }>(`SELECT count(*)::text AS count FROM rule_evaluation`);
    return Number(rows[0]?.count ?? "0");
  }
}
