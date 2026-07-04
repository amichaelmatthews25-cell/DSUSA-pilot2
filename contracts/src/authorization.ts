/**
 * contracts/authorization — canonical Authorization Service interface (PMS-3).
 *
 * SAFETY-CRITICAL. Encodes the frozen constitutional invariants in the type surface:
 *  - COMPOSITION, NOT ORIGINATION: the service composes facts owned by domain producers; it has no
 *    table of standing/eligibility and no method to set one.
 *  - FAIL CLOSED: AuthorizationDecision.allowed defaults to false on any uncertainty.
 *  - NO ENFORCEMENT CACHE: a FactProvider read is always live; there is no cache interface here.
 *  - SYNCHRONOUS + DETERMINISTIC: isAuthorized returns a decision computed now from facts read now.
 *  - REPRODUCIBLE: every decision carries the producing facts, producers, rules version, explanation,
 *    and an audit reference — so it can be recomputed from the record.
 *
 * Breaking changes require constitutional review.
 */
import type { CorrelationId } from "../../libs/types/src/index.ts";

/** A single authoritative fact consumed for composition. Owned by exactly one producer. */
export interface AuthorityFact {
  /** Fact type, e.g. "partner.standing", "operator.eligibility". */
  readonly factType: string;
  /** The authoritative producing service/agent (exactly one per fact type — single ownership). */
  readonly producingService: string;
  /** The fact value (opaque to the Authorization Service; interpreted by the composition spec). */
  readonly value: unknown;
  /** When the producer asserts this fact was current. Used for staleness exposure. */
  readonly asOf: string;
  /** Subject the fact is about (e.g., a partnerId/operatorId). */
  readonly subjectId: string;
}

/**
 * A FactProvider returns the live authoritative fact for a (factType, subjectId).
 * Implemented by the producing domain (Partner Governance, Operator Registry, ...). The Authorization
 * Service NEVER stores what these return. A provider may throw (unavailable) or time out — both fail closed.
 */
export interface FactProvider {
  readonly factType: string;
  readonly producingService: string;
  /** Live read. MUST reflect committed authoritative state (strong consistency for enforcement facts). */
  getFact(subjectId: string): Promise<AuthorityFact>;
}

/** A capability definition: which facts to compose and the predicate over them. Data, not code. */
export interface CapabilityDefinition {
  readonly code: string;
  readonly description: string;
  /** Fact types this capability composes; each must have a registered authoritative provider. */
  readonly requiredFactTypes: readonly string[];
  /**
   * The composition predicate. Pure + deterministic: given the composed facts, returns allow/deny
   * plus a human-readable explanation. NO business-rule content beyond composing the producer facts;
   * contains no I/O, no time-of-day logic, no randomness.
   */
  readonly compose: (facts: Readonly<Record<string, AuthorityFact>>) => CompositionResult;
  /** Version of the capability definition (rules version), recorded on every decision. */
  readonly version: number;
  readonly isActive: boolean;
}

export interface CompositionResult {
  readonly allowed: boolean;
  readonly explanation: string;
}

/** The context for an authorization request. */
export interface AuthorizationRequest {
  readonly actorType: string;
  readonly actorId: string;
  readonly capability: string;
  readonly subjectId: string;
  readonly correlationId: CorrelationId;
  /** Max age (ms) a fact may have before it is considered stale and the decision fails closed. */
  readonly maxFactStalenessMs?: number;
}

/**
 * The complete, reproducible authorization decision. Contains everything required to recompute it.
 * This is the value returned to callers AND the shape recorded in the decision log (a RECORD, not an
 * authoritative store of authority).
 */
export interface AuthorizationDecision {
  readonly decisionId: string;
  readonly allowed: boolean;
  readonly capability: string;
  readonly subjectId: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly timestamp: string;
  readonly correlationId: CorrelationId;
  /** The exact facts composed (frozen snapshot) — enables reproduction. */
  readonly producingFacts: Readonly<Record<string, AuthorityFact>>;
  /** The producing services for those facts. */
  readonly producingServices: readonly string[];
  /** The capability (rules) version applied. */
  readonly rulesVersion: number;
  /** Human-readable explanation, including the deny reason on failure. */
  readonly explanation: string;
  /** Reference to the audit entry recording this decision. */
  readonly auditRef: string;
  /** Reasons (machine-readable) supporting the decision/denial. */
  readonly reasons: readonly string[];
}

export interface AuthorizationService {
  /** Synchronous (awaitable) authorization. Fail-closed on any uncertainty. */
  isAuthorized(req: AuthorizationRequest): Promise<AuthorizationDecision>;
  /** Register a capability definition (admin-gated at the edge). */
  defineCapability(def: CapabilityDefinition): void;
  /** Register the single authoritative provider for a fact type. */
  registerFactProvider(provider: FactProvider): void;
}
