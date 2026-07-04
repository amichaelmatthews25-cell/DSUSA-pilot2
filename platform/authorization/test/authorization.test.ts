import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuthorizationServiceImpl,
  DuplicateProducerError,
  reproduceDecision,
} from "../domain/service.ts";
import { InMemoryDecisionLog } from "../data/decision-log.ts";
import { AuthorizationEdge } from "../interface/edge.ts";
import { InMemoryAuditSink } from "../../../libs/audit-kit/src/index.ts";
import { AuthSubstrate } from "../../../libs/auth-kit/src/index.ts";
import {
  asCorrelationId,
  type ActorContext,
} from "../../../libs/types/src/index.ts";
import type {
  AuthorityFact,
  AuthorizationRequest,
  CapabilityDefinition,
  FactProvider,
} from "../../../contracts/src/authorization.ts";

const corr = asCorrelationId("corr-authz");

/** A controllable fact provider for partner.standing. */
function standingProvider(opts: {
  value?: string;
  asOf?: () => string;
  throws?: boolean;
  delayMs?: number;
} = {}): FactProvider {
  return {
    factType: "partner.standing",
    producingService: "partner-governance",
    async getFact(subjectId: string): Promise<AuthorityFact> {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.throws) throw new Error("provider unavailable");
      return {
        factType: "partner.standing",
        producingService: "partner-governance",
        value: opts.value ?? "in_good_standing",
        asOf: opts.asOf ? opts.asOf() : new Date().toISOString(),
        subjectId,
      };
    },
  };
}

/** Capability: allow when partner standing is in_good_standing. Pure + deterministic. */
const postLoadsCapability: CapabilityDefinition = {
  code: "post_loads",
  description: "May post loads",
  requiredFactTypes: ["partner.standing"],
  version: 1,
  isActive: true,
  compose: (facts) => {
    const standing = facts["partner.standing"]?.value;
    const allowed = standing === "in_good_standing";
    return { allowed, explanation: allowed ? "partner in good standing" : `standing=${String(standing)} blocks posting` };
  },
};

function fixture(opts: Parameters<AuthorizationServiceImpl["constructor"]>[2] = {}) {
  const log = new InMemoryDecisionLog();
  const audit = new InMemoryAuditSink();
  const svc = new AuthorizationServiceImpl(log, audit, opts as object);
  return { log, audit, svc };
}

function req(over: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    actorType: "service", actorId: "freight", capability: "post_loads",
    subjectId: "partner-1", correlationId: corr, ...over,
  };
}

// ---- COMPOSITION ----
test("composition: allows when authoritative fact permits", async () => {
  const { svc } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ value: "in_good_standing" }));
  const d = await svc.isAuthorized(req());
  assert.equal(d.allowed, true);
  assert.deepEqual(d.producingServices, ["partner-governance"]);
  assert.equal(d.rulesVersion, 1);
});

test("composition: denies when authoritative fact blocks", async () => {
  const { svc } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ value: "suspended" }));
  const d = await svc.isAuthorized(req());
  assert.equal(d.allowed, false);
  assert.match(d.explanation, /blocks posting/);
});

// ---- FAIL CLOSED ----
test("fail-closed: unconfigured capability denies", async () => {
  const { svc } = fixture();
  const d = await svc.isAuthorized(req({ capability: "nonexistent" }));
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.includes("unconfigured_capability"));
});

test("fail-closed: missing provider denies", async () => {
  const { svc } = fixture();
  svc.defineCapability(postLoadsCapability);
  // no provider registered
  const d = await svc.isAuthorized(req());
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.some((r) => r.startsWith("missing_provider")));
});

test("fail-closed: provider unavailable denies", async () => {
  const { svc } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ throws: true }));
  const d = await svc.isAuthorized(req());
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.some((r) => r.startsWith("fact_unavailable")));
});

// ---- TIMEOUT ----
test("fail-closed: provider timeout denies", async () => {
  const { svc } = fixture({ factTimeoutMs: 20 });
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ delayMs: 200 }));
  const d = await svc.isAuthorized(req());
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.some((r) => r.startsWith("fact_timeout")));
});

// ---- STALE FACT ----
test("fail-closed: stale fact denies (staleness exposed)", async () => {
  const { svc } = fixture({ defaultMaxStalenessMs: 1000 });
  svc.defineCapability(postLoadsCapability);
  // asOf is 10s old -> stale
  svc.registerFactProvider(standingProvider({ asOf: () => new Date(Date.now() - 10_000).toISOString() }));
  const d = await svc.isAuthorized(req());
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.some((r) => r.startsWith("stale_fact")));
  assert.match(d.explanation, /stale/);
});

// ---- NO ENFORCEMENT CACHE / fresh read each time ----
test("no enforcement cache: changing the fact changes the very next decision", async () => {
  const { svc } = fixture();
  svc.defineCapability(postLoadsCapability);
  let standing = "in_good_standing";
  svc.registerFactProvider({
    factType: "partner.standing",
    producingService: "partner-governance",
    async getFact(subjectId) {
      return { factType: "partner.standing", producingService: "partner-governance", value: standing, asOf: new Date().toISOString(), subjectId };
    },
  });
  const allow = await svc.isAuthorized(req());
  assert.equal(allow.allowed, true);
  standing = "suspended"; // producer state changes
  const deny = await svc.isAuthorized(req());
  assert.equal(deny.allowed, false, "next decision must reflect new fact (no cached enforcement)");
});

// ---- DETERMINISTIC REPEATABILITY ----
test("deterministic: same facts + version => same allowed/explanation", async () => {
  const { svc } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ value: "in_good_standing" }));
  const a = await svc.isAuthorized(req());
  const b = await svc.isAuthorized(req());
  assert.equal(a.allowed, b.allowed);
  assert.equal(a.explanation, b.explanation);
  assert.notEqual(a.decisionId, b.decisionId, "each decision has a unique id");
});

// ---- REPLAY / REPRODUCIBILITY ----
test("reproducible: a recorded decision recomputes from its frozen facts", async () => {
  const { svc, log } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ value: "in_good_standing" }));
  const d = await svc.isAuthorized(req());
  const recorded = await log.getForAudit(d.decisionId);
  assert.ok(recorded);
  const rep = reproduceDecision(recorded!, postLoadsCapability);
  assert.equal(rep.matches, true);
  assert.equal(rep.reproducedAllowed, d.allowed);
});

test("reproducible: structural deny (unavailable) reproduces as recorded", async () => {
  const { svc, log } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ throws: true }));
  const d = await svc.isAuthorized(req());
  const recorded = await log.getForAudit(d.decisionId);
  const rep = reproduceDecision(recorded!, postLoadsCapability);
  assert.equal(rep.matches, true);
});

// ---- SINGLE PRODUCER PER FACT ----
test("single producer: a second producer for a fact type is rejected", async () => {
  const { svc } = fixture();
  svc.registerFactProvider(standingProvider());
  assert.throws(
    () => svc.registerFactProvider({
      factType: "partner.standing", producingService: "impostor",
      async getFact(s) { return { factType: "partner.standing", producingService: "impostor", value: "x", asOf: new Date().toISOString(), subjectId: s }; },
    }),
    DuplicateProducerError,
  );
});

// ---- AUDIT ----
test("every decision is audited with composed-facts snapshot", async () => {
  const { svc, audit } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider());
  const d = await svc.isAuthorized(req());
  const entries = audit.query({ action: "authorization.decided" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.id, d.auditRef);
  assert.ok((entries[0]!.metadata as Record<string, unknown>).composedFacts);
});

// ---- CONCURRENCY ----
test("concurrency: parallel decisions are independent and each audited", async () => {
  const { svc, log } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider());
  const decisions = await Promise.all(
    Array.from({ length: 20 }, (_, i) => svc.isAuthorized(req({ subjectId: `p-${i}` }))),
  );
  const ids = new Set(decisions.map((d) => d.decisionId));
  assert.equal(ids.size, 20, "every concurrent decision has a unique id");
  assert.equal(await log.count(), 20);
});

// ---- EXPLANATION CONSISTENCY ----
test("explanation consistency: deny explanation matches reason", async () => {
  const { svc } = fixture();
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider({ value: "terminated" }));
  const d = await svc.isAuthorized(req());
  assert.equal(d.allowed, false);
  assert.match(d.explanation, /terminated/);
});

// ---- EDGE GATING ----
test("edge: capability/provider registration requires platform_admin (fail-closed)", async () => {
  const { svc } = fixture();
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "ops", displayName: "Ops", roles: new Set(["platform_admin"]) });
  auth.registerService({ serviceId: "freight", displayName: "Freight", roles: new Set(["service"]) });
  const edge = new AuthorizationEdge(svc, auth);
  const nonAdmin: ActorContext = { actorType: "service", actorId: "freight", correlationId: corr };
  const admin: ActorContext = { actorType: "service", actorId: "ops", correlationId: corr };

  const denied = await edge.handle({ op: "defineCapability", admin: nonAdmin, def: postLoadsCapability });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "denied");

  const allowed = await edge.handle({ op: "defineCapability", admin, def: postLoadsCapability });
  assert.equal(allowed.ok, true);
});

test("edge: isAuthorized requires no admin and makes no nested authorization call", async () => {
  const { svc } = fixture();
  const auth = new AuthSubstrate();
  const edge = new AuthorizationEdge(svc, auth);
  svc.defineCapability(postLoadsCapability);
  svc.registerFactProvider(standingProvider());
  const res = await edge.handle({ op: "isAuthorized", req: req() });
  assert.equal(res.ok, true);
});
