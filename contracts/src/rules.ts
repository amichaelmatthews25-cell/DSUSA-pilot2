/**
 * contracts/rules — canonical Rules Engine interface (PMS-4). POLICY-CRITICAL.
 *
 * The engine EXECUTES policy; it never DEFINES policy. Therefore:
 *  - A RuleSet is EXTERNAL DATA supplied by callers (loaded from config/governance), never embedded
 *    in engine code. The engine ships zero business rules.
 *  - The expression language is a small, closed, deterministic AST with NO business vocabulary — only
 *    generic operators over caller-supplied inputs. "partner.standing == 'good'" is data, not code.
 *  - Evaluation is pure: identical (ruleSet version + inputs) => identical output. No I/O, no clock,
 *    no randomness, no authorization call, no business-table access.
 *  - Every evaluation is fully recorded for replay + explainability.
 *
 * Breaking changes require constitutional review.
 */
import type { CorrelationId } from "../../libs/types/src/index.ts";

/** A closed expression AST. Deterministic; operates only on supplied inputs + literals. */
export type Expr =
  | { kind: "lit"; value: string | number | boolean | null }
  | { kind: "input"; path: string } // reads from supplied inputs by dotted path
  | { kind: "not"; expr: Expr }
  | { kind: "and"; exprs: readonly Expr[] }
  | { kind: "or"; exprs: readonly Expr[] }
  | { kind: "cmp"; op: CmpOp; left: Expr; right: Expr }
  | { kind: "in"; left: Expr; set: readonly (string | number | boolean | null)[] };

export type CmpOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte";

/** A single rule: when `condition` holds, it contributes `effect` (an opaque outcome token + reason). */
export interface Rule {
  readonly id: string;
  readonly description: string;
  readonly condition: Expr;
  /** Opaque outcome token the CALLER interprets (e.g., "DENY", "REQUIRE_REVIEW"). Engine never interprets. */
  readonly effect: string;
  /** Reason emitted when this rule fires (explainability). */
  readonly reason: string;
}

/** A versioned, immutable rule set. Identity = (ruleSetId, version). */
export interface RuleSet {
  readonly ruleSetId: string;
  readonly version: number;
  readonly rules: readonly Rule[];
  /** Default effect when no rule fires. */
  readonly defaultEffect: string;
}

/** Inputs supplied by the caller. The engine reads ONLY these — never a business table. */
export type RuleInputs = Readonly<Record<string, unknown>>;

export interface EvaluationRequest {
  readonly ruleSetId: string;
  readonly version: number;
  readonly inputs: RuleInputs;
  readonly correlationId: CorrelationId;
  /** Dry-run: evaluate + explain but record nothing durable (no state mutation). */
  readonly dryRun?: boolean;
}

/** A fired rule, for explanation. */
export interface FiredRule {
  readonly ruleId: string;
  readonly effect: string;
  readonly reason: string;
}

/** The complete, reproducible evaluation record. */
export interface EvaluationResult {
  readonly evaluationId: string;
  readonly ruleSetId: string;
  readonly version: number;
  readonly timestamp: string;
  readonly inputs: RuleInputs;
  /** Ordered effects produced (rules evaluated in definition order; deterministic). */
  readonly effects: readonly string[];
  readonly firedRules: readonly FiredRule[];
  /** The resolved effect: first fired rule's effect, else the rule set's defaultEffect. */
  readonly resolvedEffect: string;
  readonly explanation: string;
  readonly correlationId: CorrelationId;
  readonly auditRef: string;
  readonly dryRun: boolean;
}

export interface RulesEngine {
  /** Register an immutable rule-set version (external data). Re-registering an existing version is rejected. */
  registerRuleSet(ruleSet: RuleSet): void;
  /** Evaluate supplied inputs against a specific rule-set version. Pure + deterministic. */
  evaluate(req: EvaluationRequest): Promise<EvaluationResult>;
  /** Replay: re-evaluate a recorded evaluation from its stored inputs + version; must match. */
  replay(evaluationId: string): Promise<{ original: EvaluationResult; replayed: EvaluationResult; matches: boolean }>;
  /** List registered versions of a rule set (for coexistence/migration testing). */
  versionsOf(ruleSetId: string): readonly number[];
}
