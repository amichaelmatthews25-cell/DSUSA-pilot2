/**
 * platform/rules/domain/evaluator.ts — the deterministic expression interpreter + validator.
 *
 * POLICY-CRITICAL property: this interpreter contains NO business vocabulary. It evaluates a closed,
 * generic AST (literals, input lookups, boolean ops, comparisons, membership) over caller-supplied
 * inputs. It has no knowledge of partners, operators, loads, standing, eligibility, etc. All such
 * meaning lives in the rule-set DATA the caller supplies. The interpreter is pure: no I/O, no clock,
 * no randomness — identical (expr, inputs) => identical value.
 */
import type { CmpOp, Expr, Rule, RuleSet } from "../../../contracts/src/rules.ts";

export class MalformedRuleError extends Error {
  override readonly name = "MalformedRuleError";
}

/** Resolve a dotted path against the supplied inputs. Returns undefined if absent. */
function readPath(inputs: Readonly<Record<string, unknown>>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".");
  let cur: unknown = inputs;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function asComparable(v: unknown): string | number | boolean | null {
  if (v === null) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v as string | number | boolean;
  // Non-primitive comparands are not permitted (keeps comparison total + deterministic).
  throw new MalformedRuleError(`non-comparable value in expression: ${JSON.stringify(v)}`);
}

function compare(op: CmpOp, l: unknown, r: unknown): boolean {
  const a = asComparable(l);
  const b = asComparable(r);
  switch (op) {
    case "eq": return a === b;
    case "ne": return a !== b;
    case "lt": return (a as number | string) < (b as number | string);
    case "lte": return (a as number | string) <= (b as number | string);
    case "gt": return (a as number | string) > (b as number | string);
    case "gte": return (a as number | string) >= (b as number | string);
    default: {
      const _e: never = op;
      throw new MalformedRuleError(`unknown comparison op: ${String(op)}`);
    }
  }
}

/** Evaluate an expression to a value. Pure + total (throws MalformedRuleError on malformed AST). */
export function evalExpr(expr: Expr, inputs: Readonly<Record<string, unknown>>): unknown {
  switch (expr.kind) {
    case "lit": return expr.value;
    case "input": return readPath(inputs, expr.path);
    case "not": return !truthy(evalExpr(expr.expr, inputs));
    case "and": return expr.exprs.every((e) => truthy(evalExpr(e, inputs)));
    case "or": return expr.exprs.some((e) => truthy(evalExpr(e, inputs)));
    case "cmp": return compare(expr.op, evalExpr(expr.left, inputs), evalExpr(expr.right, inputs));
    case "in": {
      const v = asComparable(evalExpr(expr.left, inputs));
      return expr.set.includes(v);
    }
    default: {
      const _e: never = expr;
      throw new MalformedRuleError(`unknown expression kind: ${JSON.stringify(expr)}`);
    }
  }
}

function truthy(v: unknown): boolean {
  return v === true;
}

/** Validate a rule set's structure + AST. Throws MalformedRuleError on any defect (rule rejection). */
export function validateRuleSet(rs: RuleSet): void {
  if (!rs.ruleSetId || typeof rs.version !== "number" || rs.version < 1) {
    throw new MalformedRuleError("rule set requires ruleSetId and version >= 1");
  }
  if (typeof rs.defaultEffect !== "string" || rs.defaultEffect.length === 0) {
    throw new MalformedRuleError("rule set requires a non-empty defaultEffect");
  }
  if (!Array.isArray(rs.rules)) throw new MalformedRuleError("rules must be an array");
  const seen = new Set<string>();
  for (const rule of rs.rules) validateRule(rule, seen);
}

function validateRule(rule: Rule, seen: Set<string>): void {
  if (!rule.id) throw new MalformedRuleError("rule requires an id");
  if (seen.has(rule.id)) throw new MalformedRuleError(`duplicate rule id: ${rule.id}`);
  seen.add(rule.id);
  if (typeof rule.effect !== "string" || rule.effect.length === 0) {
    throw new MalformedRuleError(`rule ${rule.id} requires a non-empty effect`);
  }
  if (typeof rule.reason !== "string") throw new MalformedRuleError(`rule ${rule.id} requires a reason`);
  validateExpr(rule.condition, 0);
}

const MAX_DEPTH = 64;
function validateExpr(expr: Expr, depth: number): void {
  if (depth > MAX_DEPTH) throw new MalformedRuleError("expression nesting too deep");
  if (!expr || typeof expr !== "object" || typeof (expr as { kind?: unknown }).kind !== "string") {
    throw new MalformedRuleError("expression node missing 'kind'");
  }
  switch (expr.kind) {
    case "lit": break;
    case "input":
      if (typeof expr.path !== "string" || expr.path.length === 0) {
        throw new MalformedRuleError("input expression requires a non-empty path");
      }
      break;
    case "not": validateExpr(expr.expr, depth + 1); break;
    case "and":
    case "or":
      if (!Array.isArray(expr.exprs) || expr.exprs.length === 0) {
        throw new MalformedRuleError(`${expr.kind} requires a non-empty exprs array`);
      }
      for (const e of expr.exprs) validateExpr(e, depth + 1);
      break;
    case "cmp":
      if (!["eq", "ne", "lt", "lte", "gt", "gte"].includes(expr.op)) {
        throw new MalformedRuleError(`invalid cmp op: ${String(expr.op)}`);
      }
      validateExpr(expr.left, depth + 1);
      validateExpr(expr.right, depth + 1);
      break;
    case "in":
      validateExpr(expr.left, depth + 1);
      if (!Array.isArray(expr.set)) throw new MalformedRuleError("in.set must be an array");
      break;
    default:
      throw new MalformedRuleError(`unknown expression kind: ${String((expr as { kind: unknown }).kind)}`);
  }
}
