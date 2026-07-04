/**
 * platform/rules/data — persistence for the Rules Engine.
 *
 * Two ports, both owned ONLY by the Rules Engine:
 *  - RuleSetRegistry: immutable storage of (ruleSetId, version) rule sets. Re-registering an existing
 *    version is rejected (immutable rule history). Rule sets are EXTERNAL DATA loaded here, not code.
 *  - EvaluationLog: append-only record of evaluations for replay + explainability.
 *
 * No business tables. The engine reads/writes ONLY these engine-owned stores.
 */
import type { EvaluationResult, RuleSet } from "../../../contracts/src/rules.ts";

export class ImmutableRuleSetError extends Error {
  override readonly name = "ImmutableRuleSetError";
}

export interface RuleSetRegistry {
  /** Store a new (ruleSetId, version). Throws ImmutableRuleSetError if that version already exists. */
  put(ruleSet: RuleSet): void;
  get(ruleSetId: string, version: number): RuleSet | null;
  versions(ruleSetId: string): readonly number[];
}

export interface EvaluationLog {
  append(result: EvaluationResult): Promise<EvaluationResult>;
  getById(evaluationId: string): Promise<EvaluationResult | null>;
  count(): Promise<number>;
}

/** In-memory immutable registry (test + F-stage). */
export class InMemoryRuleSetRegistry implements RuleSetRegistry {
  private readonly map = new Map<string, RuleSet>();
  private key(id: string, v: number): string {
    return `${id}\u0000${v}`;
  }
  put(ruleSet: RuleSet): void {
    const k = this.key(ruleSet.ruleSetId, ruleSet.version);
    if (this.map.has(k)) {
      throw new ImmutableRuleSetError(
        `rule set ${ruleSet.ruleSetId} v${ruleSet.version} already exists; versions are immutable`,
      );
    }
    // Deep-freeze the stored rule set so history cannot mutate.
    this.map.set(k, deepFreeze(structuredCloneSafe(ruleSet)));
  }
  get(ruleSetId: string, version: number): RuleSet | null {
    return this.map.get(this.key(ruleSetId, version)) ?? null;
  }
  versions(ruleSetId: string): readonly number[] {
    const out: number[] = [];
    for (const k of this.map.keys()) {
      const [id, v] = k.split("\u0000");
      if (id === ruleSetId) out.push(Number(v));
    }
    return out.sort((a, b) => a - b);
  }
}

/** In-memory append-only evaluation log (test + F-stage). */
export class InMemoryEvaluationLog implements EvaluationLog {
  private readonly byId = new Map<string, EvaluationResult>();
  async append(result: EvaluationResult): Promise<EvaluationResult> {
    const existing = this.byId.get(result.evaluationId);
    if (existing) return existing;
    this.byId.set(result.evaluationId, result);
    return result;
  }
  async getById(evaluationId: string): Promise<EvaluationResult | null> {
    return this.byId.get(evaluationId) ?? null;
  }
  async count(): Promise<number> {
    return this.byId.size;
  }
}

// --- helpers ---
function structuredCloneSafe<T>(v: T): T {
  const sc = (globalThis as { structuredClone?: <U>(x: U) => U }).structuredClone;
  if (typeof sc === "function") return sc(v);
  return JSON.parse(JSON.stringify(v)) as T;
}
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}
