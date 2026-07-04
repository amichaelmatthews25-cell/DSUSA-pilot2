/**
 * platform/rules/domain/engine.ts — Rules Engine (PMS-4). POLICY-CRITICAL.
 *
 * Executes supplied rule sets deterministically. Records every evaluation for replay + explainability.
 * NEVER calls the Authorization Service (cycle-break). NEVER reads/writes business tables (it only
 * touches engine-owned stores and the Audit sink). Owns no policy: rules are external data.
 */
import type {
  EvaluationRequest,
  EvaluationResult,
  FiredRule,
  RuleSet,
  RulesEngine,
} from "../../../contracts/src/rules.ts";
import type { AuditSink } from "../../../libs/audit-kit/src/index.ts";
import { asIdempotencyKey, newOpaqueId, nowTs } from "../../../libs/types/src/index.ts";
import type { EvaluationLog, RuleSetRegistry } from "../data/store.ts";
import { evalExpr, validateRuleSet, MalformedRuleError } from "./evaluator.ts";

const SOURCE = "rules-engine";

export class RuleSetNotFoundError extends Error {
  override readonly name = "RuleSetNotFoundError";
}

export class RulesEngineImpl implements RulesEngine {
  private readonly registry: RuleSetRegistry;
  private readonly log: EvaluationLog;
  private readonly audit: AuditSink;
  /** Injected clock ONLY for the evaluation record timestamp — never used inside rule logic. */
  private readonly clock: () => string;

  constructor(registry: RuleSetRegistry, log: EvaluationLog, audit: AuditSink, clock: () => string = nowTs) {
    this.registry = registry;
    this.log = log;
    this.audit = audit;
    this.clock = clock;
  }

  registerRuleSet(ruleSet: RuleSet): void {
    // Validate before storing — malformed rule sets are rejected (never executed).
    validateRuleSet(ruleSet);
    this.registry.put(ruleSet); // immutable: re-registering a version throws.
  }

  versionsOf(ruleSetId: string): readonly number[] {
    return this.registry.versions(ruleSetId);
  }

  async evaluate(req: EvaluationRequest): Promise<EvaluationResult> {
    const ruleSet = this.registry.get(req.ruleSetId, req.version);
    if (!ruleSet) {
      throw new RuleSetNotFoundError(`rule set ${req.ruleSetId} v${req.version} not registered`);
    }
    const result = this.pureEvaluate(ruleSet, req);

    // Audit (transactional). Dry-run is still audited as an evaluation, but NOT written to the
    // evaluation log (no durable evaluation record / no state mutation beyond the audit trail).
    const auditEntry = await this.audit.record({
      actorType: "service", actorId: SOURCE, action: req.dryRun ? "rules.dry_run" : "rules.evaluated",
      entityType: "rule_set", entityId: `${req.ruleSetId}:v${req.version}`,
      metadata: {
        evaluationId: result.evaluationId, resolvedEffect: result.resolvedEffect,
        firedRules: result.firedRules, dryRun: req.dryRun === true,
      },
      sourceComponent: SOURCE, correlationId: req.correlationId,
      idempotencyKey: asIdempotencyKey(`rules-${result.evaluationId}`),
    }, "transactional");

    const withAudit: EvaluationResult = { ...result, auditRef: auditEntry.id };

    if (!req.dryRun) {
      await this.log.append(withAudit);
    }
    return withAudit;
  }

  /** Pure evaluation: deterministic, no side effects. Same (ruleSet, inputs) => same result body. */
  private pureEvaluate(ruleSet: RuleSet, req: EvaluationRequest): EvaluationResult {
    const fired: FiredRule[] = [];
    const effects: string[] = [];
    // Rules evaluated in DEFINITION ORDER (deterministic).
    for (const rule of ruleSet.rules) {
      let matched: boolean;
      try {
        matched = evalExpr(rule.condition, req.inputs) === true;
      } catch (err) {
        if (err instanceof MalformedRuleError) throw err;
        throw new MalformedRuleError(`evaluation error in rule ${rule.id}: ${String(err)}`);
      }
      if (matched) {
        fired.push({ ruleId: rule.id, effect: rule.effect, reason: rule.reason });
        effects.push(rule.effect);
      }
    }
    const resolvedEffect = fired.length > 0 ? fired[0]!.effect : ruleSet.defaultEffect;
    const explanation = fired.length > 0
      ? `resolved '${resolvedEffect}' from rule ${fired[0]!.ruleId}: ${fired[0]!.reason}` +
        (fired.length > 1 ? ` (+${fired.length - 1} more fired)` : "")
      : `no rule fired; default '${ruleSet.defaultEffect}'`;

    return {
      evaluationId: newOpaqueId(),
      ruleSetId: ruleSet.ruleSetId,
      version: ruleSet.version,
      timestamp: this.clock(),
      inputs: req.inputs,
      effects,
      firedRules: fired,
      resolvedEffect,
      explanation,
      correlationId: req.correlationId,
      auditRef: "", // filled by evaluate()
      dryRun: req.dryRun === true,
    };
  }

  async replay(evaluationId: string): Promise<{ original: EvaluationResult; replayed: EvaluationResult; matches: boolean }> {
    const original = await this.log.getById(evaluationId);
    if (!original) throw new RuleSetNotFoundError(`no recorded evaluation ${evaluationId}`);
    const ruleSet = this.registry.get(original.ruleSetId, original.version);
    if (!ruleSet) throw new RuleSetNotFoundError(`rule set ${original.ruleSetId} v${original.version} not registered`);
    // Re-run the pure evaluation against the SAME stored inputs + version.
    const replayed = this.pureEvaluate(ruleSet, {
      ruleSetId: original.ruleSetId, version: original.version,
      inputs: original.inputs, correlationId: original.correlationId, dryRun: true,
    });
    const matches =
      replayed.resolvedEffect === original.resolvedEffect &&
      JSON.stringify(replayed.effects) === JSON.stringify(original.effects) &&
      JSON.stringify(replayed.firedRules) === JSON.stringify(original.firedRules);
    return { original, replayed, matches };
  }
}
