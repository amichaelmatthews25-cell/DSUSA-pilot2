/**
 * platform/authorization/domain — Authorization Service logic (PMS-3). SAFETY-CRITICAL.
 *
 * Implements AuthorizationService. Composes authoritative facts read LIVE from their single producers,
 * applies a capability's deterministic predicate, returns a fail-closed, fully-reproducible decision,
 * and records that decision to the append-only log + Audit.
 *
 * Constitutional guarantees enforced here:
 *  - COMPOSITION, NOT ORIGINATION: facts come from FactProviders; the service stores no authority.
 *  - SINGLE PRODUCER PER FACT: registerFactProvider rejects a second provider for a fact type.
 *  - FAIL CLOSED: provider error/timeout/missing/stale/unconfigured => allowed=false.
 *  - NO ENFORCEMENT CACHE: every isAuthorized reads providers live; the decision log is never read here.
 *  - DETERMINISTIC: given the same facts + capability version, the same decision (modulo ids/time).
 *  - REPRODUCIBLE: the decision carries facts, producers, rules version, explanation, audit ref.
 *  - NO BUSINESS RULES: the service only composes; predicate content lives in capability definitions.
 *  - NO DEPENDENCY ON DOWNSTREAM AGENTS: providers are injected (inversion); the service imports none.
 */
import type {
  AuthorityFact,
  AuthorizationDecision,
  AuthorizationRequest,
  AuthorizationService,
  CapabilityDefinition,
  FactProvider,
} from "../../../contracts/src/authorization.ts";
import type { AuditSink } from "../../../libs/audit-kit/src/index.ts";
import { asIdempotencyKey, newOpaqueId, nowTs } from "../../../libs/types/src/index.ts";
import type { DecisionLogStore } from "../data/decision-log.ts";

const SOURCE = "authorization-service";
const DEFAULT_FACT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_STALENESS_MS = 30_000;

export class DuplicateProducerError extends Error {
  override readonly name = "DuplicateProducerError";
}

export interface AuthorizationOptions {
  /** Per-fact read timeout. A provider that exceeds this fails closed. */
  readonly factTimeoutMs?: number;
  /** Default staleness ceiling if the request does not specify one. */
  readonly defaultMaxStalenessMs?: number;
  /** Injected clock for deterministic tests. */
  readonly now?: () => number;
}

export class AuthorizationServiceImpl implements AuthorizationService {
  private readonly log: DecisionLogStore;
  private readonly audit: AuditSink;
  private readonly factTimeoutMs: number;
  private readonly defaultMaxStalenessMs: number;
  private readonly now: () => number;

  private readonly capabilities = new Map<string, CapabilityDefinition>();
  /** Exactly one provider per fact type (single authoritative producer). */
  private readonly providers = new Map<string, FactProvider>();

  constructor(log: DecisionLogStore, audit: AuditSink, opts: AuthorizationOptions = {}) {
    this.log = log;
    this.audit = audit;
    this.factTimeoutMs = opts.factTimeoutMs ?? DEFAULT_FACT_TIMEOUT_MS;
    this.defaultMaxStalenessMs = opts.defaultMaxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  defineCapability(def: CapabilityDefinition): void {
    this.capabilities.set(def.code, def);
  }

  registerFactProvider(provider: FactProvider): void {
    const existing = this.providers.get(provider.factType);
    if (existing && existing.producingService !== provider.producingService) {
      // SINGLE PRODUCER PER FACT: a second authoritative producer for one fact type is forbidden.
      throw new DuplicateProducerError(
        `fact type '${provider.factType}' already has authoritative producer ` +
          `'${existing.producingService}'; refusing to register '${provider.producingService}'`,
      );
    }
    this.providers.set(provider.factType, provider);
  }

  async isAuthorized(req: AuthorizationRequest): Promise<AuthorizationDecision> {
    const decisionId = newOpaqueId();
    const timestamp = nowTs();
    const maxStaleness = req.maxFactStalenessMs ?? this.defaultMaxStalenessMs;
    const reasons: string[] = [];

    const cap = this.capabilities.get(req.capability);

    // FAIL CLOSED: unconfigured capability.
    if (!cap || !cap.isActive) {
      return this.deny(decisionId, timestamp, req, {}, [], 0,
        `capability '${req.capability}' is not configured/active`, ["unconfigured_capability"]);
    }

    // Read every required fact LIVE from its single authoritative provider.
    const facts: Record<string, AuthorityFact> = {};
    const producingServices = new Set<string>();
    const nowMs = this.now();

    for (const factType of cap.requiredFactTypes) {
      const provider = this.providers.get(factType);
      if (!provider) {
        return this.deny(decisionId, timestamp, req, facts, [...producingServices], cap.version,
          `no authoritative provider registered for fact '${factType}'`,
          ["missing_provider:" + factType]);
      }
      let fact: AuthorityFact;
      try {
        fact = await this.withTimeout(provider.getFact(req.subjectId), this.factTimeoutMs, factType);
      } catch (err) {
        // FAIL CLOSED on provider unavailable / timeout.
        const why = err instanceof FactTimeoutError ? "timeout" : "unavailable";
        return this.deny(decisionId, timestamp, req, facts, [...producingServices], cap.version,
          `authoritative fact '${factType}' ${why} (${err instanceof Error ? err.message : String(err)})`,
          [`fact_${why}:` + factType]);
      }

      // FAIL CLOSED on stale fact (staleness is EXPOSED, never hidden).
      const ageMs = nowMs - Date.parse(fact.asOf);
      if (Number.isNaN(ageMs) || ageMs > maxStaleness) {
        return this.deny(decisionId, timestamp, req, facts, [...producingServices], cap.version,
          `authoritative fact '${factType}' is stale (age ${ageMs}ms > ${maxStaleness}ms)`,
          ["stale_fact:" + factType]);
      }

      facts[factType] = fact;
      producingServices.add(fact.producingService);
    }

    // Compose: deterministic predicate over the live facts. No I/O, no time, no randomness.
    let result;
    try {
      result = cap.compose(Object.freeze({ ...facts }));
    } catch (err) {
      // FAIL CLOSED if a composition predicate throws.
      return this.deny(decisionId, timestamp, req, facts, [...producingServices], cap.version,
        `composition error: ${err instanceof Error ? err.message : String(err)}`,
        ["composition_error"]);
    }

    if (result.allowed) reasons.push("composed_allow");
    else reasons.push("composed_deny");

    return this.finalize(decisionId, timestamp, req, facts, [...producingServices], cap.version,
      result.allowed, result.explanation, reasons);
  }

  // ---- internals ----

  private async deny(
    decisionId: string, timestamp: string, req: AuthorizationRequest,
    facts: Record<string, AuthorityFact>, producingServices: string[], rulesVersion: number,
    explanation: string, reasons: string[],
  ): Promise<AuthorizationDecision> {
    return this.finalize(decisionId, timestamp, req, facts, producingServices, rulesVersion,
      false, explanation, reasons);
  }

  private async finalize(
    decisionId: string, timestamp: string, req: AuthorizationRequest,
    facts: Record<string, AuthorityFact>, producingServices: string[], rulesVersion: number,
    allowed: boolean, explanation: string, reasons: string[],
  ): Promise<AuthorizationDecision> {
    // Audit FIRST so auditRef is available on the returned decision and the decision is always audited.
    const auditEntry = await this.audit.record({
      actorType: "service",
      actorId: SOURCE,
      action: "authorization.decided",
      entityType: "authorization",
      entityId: decisionId,
      metadata: {
        capability: req.capability, subjectId: req.subjectId, allowed,
        actorType: req.actorType, actorId: req.actorId,
        producingServices, rulesVersion, reasons,
        // composed_facts_snapshot proves which producer each fact came from (composition auditable).
        composedFacts: facts,
      },
      sourceComponent: SOURCE,
      correlationId: req.correlationId,
      idempotencyKey: asIdempotencyKey(`authz-${decisionId}`),
    }, "transactional");

    const decision: AuthorizationDecision = {
      decisionId,
      allowed,
      capability: req.capability,
      subjectId: req.subjectId,
      actorType: req.actorType,
      actorId: req.actorId,
      timestamp,
      correlationId: req.correlationId,
      producingFacts: Object.freeze({ ...facts }),
      producingServices,
      rulesVersion,
      explanation,
      auditRef: auditEntry.id,
      reasons,
    };

    // Record the reproducible decision to the append-only log (a RECORD, never read for enforcement).
    await this.log.append(decision);
    return decision;
  }

  private async withTimeout<T>(p: Promise<T>, ms: number, factType: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new FactTimeoutError(`fact '${factType}' read exceeded ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export class FactTimeoutError extends Error {
  override readonly name = "FactTimeoutError";
}

/**
 * Reproduce a past decision from its recorded facts + a capability definition.
 * Proves decisions are reproducible (PMS-3 requirement): re-running compose on the frozen
 * producingFacts yields the same allowed/explanation that was recorded.
 */
export function reproduceDecision(
  recorded: AuthorizationDecision,
  capability: CapabilityDefinition,
): { reproducedAllowed: boolean; matches: boolean; explanation: string } {
  // Only reproducible when the recorded rules version matches the provided capability version.
  if (recorded.rulesVersion !== capability.version) {
    return { reproducedAllowed: recorded.allowed, matches: false, explanation: "rules version mismatch" };
  }
  // If the decision denied for a non-composition reason (e.g., stale/unavailable), there are no facts
  // to recompose; reproduction means "same recorded outcome" since the deny is structural.
  const composedReasons = recorded.reasons.includes("composed_allow") || recorded.reasons.includes("composed_deny");
  if (!composedReasons) {
    return { reproducedAllowed: recorded.allowed, matches: true, explanation: "structural deny reproduced" };
  }
  const res = capability.compose(Object.freeze({ ...recorded.producingFacts }));
  return {
    reproducedAllowed: res.allowed,
    matches: res.allowed === recorded.allowed,
    explanation: res.explanation,
  };
}
