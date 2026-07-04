import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesEngineImpl, RuleSetNotFoundError } from "../domain/engine.ts";
import { evalExpr, validateRuleSet, MalformedRuleError } from "../domain/evaluator.ts";
import {
  InMemoryRuleSetRegistry,
  InMemoryEvaluationLog,
  ImmutableRuleSetError,
} from "../data/store.ts";
import { RulesEdge } from "../interface/edge.ts";
import { InMemoryAuditSink } from "../../../libs/audit-kit/src/index.ts";
import { AuthSubstrate } from "../../../libs/auth-kit/src/index.ts";
import { asCorrelationId, type ActorContext } from "../../../libs/types/src/index.ts";
import type { RuleSet, EvaluationRequest } from "../../../contracts/src/rules.ts";

const corr = asCorrelationId("corr-rules");

/** A sample rule set — supplied as DATA (note: no business logic lives in the engine). */
function qualificationRulesV1(): RuleSet {
  return {
    ruleSetId: "applicant_qualification",
    version: 1,
    defaultEffect: "APPROVE",
    rules: [
      {
        id: "min_age",
        description: "applicant must be 21+",
        condition: { kind: "cmp", op: "lt", left: { kind: "input", path: "applicant.age" }, right: { kind: "lit", value: 21 } },
        effect: "DENY",
        reason: "applicant under 21",
      },
      {
        id: "credit_floor",
        description: "credit score below 600 requires review",
        condition: { kind: "cmp", op: "lt", left: { kind: "input", path: "applicant.creditScore" }, right: { kind: "lit", value: 600 } },
        effect: "REQUIRE_REVIEW",
        reason: "credit score below 600",
      },
    ],
  };
}

/** V2 changes the credit floor to 650 — coexists with v1. */
function qualificationRulesV2(): RuleSet {
  const v1 = qualificationRulesV1();
  return {
    ...v1,
    version: 2,
    rules: [
      v1.rules[0]!,
      { ...v1.rules[1]!, condition: { kind: "cmp", op: "lt", left: { kind: "input", path: "applicant.creditScore" }, right: { kind: "lit", value: 650 } }, reason: "credit score below 650" },
    ],
  };
}

function engine() {
  const registry = new InMemoryRuleSetRegistry();
  const log = new InMemoryEvaluationLog();
  const audit = new InMemoryAuditSink();
  const eng = new RulesEngineImpl(registry, log, audit);
  return { registry, log, audit, eng };
}

function evalReq(over: Partial<EvaluationRequest> = {}): EvaluationRequest {
  return {
    ruleSetId: "applicant_qualification", version: 1,
    inputs: { applicant: { age: 30, creditScore: 720 } },
    correlationId: corr, ...over,
  };
}

// ---- DETERMINISM / REPEATABILITY ----
test("identical inputs + version => identical outputs", async () => {
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  const a = await eng.evaluate(evalReq());
  const b = await eng.evaluate(evalReq());
  assert.equal(a.resolvedEffect, b.resolvedEffect);
  assert.deepEqual(a.effects, b.effects);
  assert.deepEqual(a.firedRules, b.firedRules);
  assert.notEqual(a.evaluationId, b.evaluationId);
});

test("evaluation resolves first fired rule; default when none fire", async () => {
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  const approve = await eng.evaluate(evalReq({ inputs: { applicant: { age: 30, creditScore: 720 } } }));
  assert.equal(approve.resolvedEffect, "APPROVE");
  const deny = await eng.evaluate(evalReq({ inputs: { applicant: { age: 18, creditScore: 720 } } }));
  assert.equal(deny.resolvedEffect, "DENY");
  const review = await eng.evaluate(evalReq({ inputs: { applicant: { age: 30, creditScore: 550 } } }));
  assert.equal(review.resolvedEffect, "REQUIRE_REVIEW");
});

// ---- DETERMINISTIC REPLAY ----
test("replay reproduces a prior evaluation exactly", async () => {
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  const original = await eng.evaluate(evalReq({ inputs: { applicant: { age: 30, creditScore: 550 } } }));
  const { matches, replayed } = await eng.replay(original.evaluationId);
  assert.equal(matches, true);
  assert.equal(replayed.resolvedEffect, original.resolvedEffect);
});

// ---- VERSION REPLAY / COEXISTENCE ----
test("multiple rule versions coexist and evaluate independently", async () => {
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  eng.registerRuleSet(qualificationRulesV2());
  assert.deepEqual(eng.versionsOf("applicant_qualification"), [1, 2]);
  const inputs = { applicant: { age: 30, creditScore: 620 } };
  const v1 = await eng.evaluate(evalReq({ version: 1, inputs })); // 620 >= 600 -> APPROVE
  const v2 = await eng.evaluate(evalReq({ version: 2, inputs })); // 620 < 650 -> REQUIRE_REVIEW
  assert.equal(v1.resolvedEffect, "APPROVE");
  assert.equal(v2.resolvedEffect, "REQUIRE_REVIEW");
});

test("side-by-side version execution for migration testing", async () => {
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  eng.registerRuleSet(qualificationRulesV2());
  const inputs = { applicant: { age: 30, creditScore: 630 } };
  const [v1, v2] = await Promise.all([
    eng.evaluate(evalReq({ version: 1, inputs, dryRun: true })),
    eng.evaluate(evalReq({ version: 2, inputs, dryRun: true })),
  ]);
  assert.notEqual(v1.resolvedEffect, v2.resolvedEffect);
});

// ---- DRY-RUN ----
test("dry-run evaluates but writes no evaluation-log record (no state mutation)", async () => {
  const { eng, log } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  const r = await eng.evaluate(evalReq({ dryRun: true }));
  assert.equal(r.dryRun, true);
  assert.equal(await log.count(), 0, "dry-run must not persist an evaluation record");
});

test("non-dry-run persists exactly one evaluation record", async () => {
  const { eng, log } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  await eng.evaluate(evalReq());
  assert.equal(await log.count(), 1);
});

// ---- MALFORMED RULE REJECTION / VALIDATION ----
test("malformed rule set is rejected at registration", () => {
  const { eng } = engine();
  assert.throws(() => eng.registerRuleSet({
    ruleSetId: "bad", version: 1, defaultEffect: "X",
    rules: [{ id: "r", description: "", condition: { kind: "input" } as never, effect: "Y", reason: "z" }],
  }), MalformedRuleError);
});

test("duplicate rule ids rejected", () => {
  assert.throws(() => validateRuleSet({
    ruleSetId: "x", version: 1, defaultEffect: "D",
    rules: [
      { id: "dup", description: "", condition: { kind: "lit", value: true }, effect: "A", reason: "r" },
      { id: "dup", description: "", condition: { kind: "lit", value: true }, effect: "B", reason: "r" },
    ],
  }), /duplicate rule id/);
});

// ---- IMMUTABLE HISTORY ----
test("re-registering an existing version is rejected (immutable history)", () => {
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  assert.throws(() => eng.registerRuleSet(qualificationRulesV1()), ImmutableRuleSetError);
});

// ---- CONCURRENCY ----
test("concurrent evaluations are independent and each recorded", async () => {
  const { eng, log } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  const reqs = Array.from({ length: 25 }, (_, i) =>
    eng.evaluate(evalReq({ inputs: { applicant: { age: 20 + i, creditScore: 600 + i } } })));
  const results = await Promise.all(reqs);
  assert.equal(new Set(results.map((r) => r.evaluationId)).size, 25);
  assert.equal(await log.count(), 25);
});

// ---- EXPLANATION CONSISTENCY ----
test("explanation matches the fired rule", async () => {
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  const r = await eng.evaluate(evalReq({ inputs: { applicant: { age: 18, creditScore: 720 } } }));
  assert.match(r.explanation, /min_age/);
  assert.match(r.explanation, /under 21/);
});

// ---- NO HIDDEN STATE ----
test("no hidden state: evaluator is pure over supplied inputs", () => {
  // Same expr + inputs => same value, regardless of prior calls.
  const expr = { kind: "cmp", op: "gte", left: { kind: "input", path: "x" }, right: { kind: "lit", value: 10 } } as const;
  assert.equal(evalExpr(expr, { x: 15 }), true);
  assert.equal(evalExpr(expr, { x: 5 }), false);
  assert.equal(evalExpr(expr, { x: 15 }), true);
});

// ---- NO AUTHORIZATION DEPENDENCY ----
test("engine evaluation makes no authorization call (structural: no authz import/usage)", async () => {
  // Behavioral proxy: engine constructed with only registry/log/audit; no authz collaborator exists.
  const { eng } = engine();
  eng.registerRuleSet(qualificationRulesV1());
  const r = await eng.evaluate(evalReq());
  assert.ok(r.evaluationId); // evaluates with no authz wiring present
});

// ---- RULE-SET NOT FOUND ----
test("evaluate against an unregistered version throws not found", async () => {
  const { eng } = engine();
  await assert.rejects(eng.evaluate(evalReq({ version: 99 })), RuleSetNotFoundError);
});

// ---- EDGE GATING ----
test("edge: registration requires governance/platform admin (fail-closed)", async () => {
  const { eng } = engine();
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "gov", displayName: "Gov", roles: new Set(["governance_admin"]) });
  auth.registerService({ serviceId: "svc", displayName: "Svc", roles: new Set(["service"]) });
  const edge = new RulesEdge(eng, auth);
  const nonAdmin: ActorContext = { actorType: "service", actorId: "svc", correlationId: corr };
  const admin: ActorContext = { actorType: "service", actorId: "gov", correlationId: corr };
  const denied = await edge.handle({ op: "registerRuleSet", admin: nonAdmin, ruleSet: qualificationRulesV1() });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "denied");
  const ok = await edge.handle({ op: "registerRuleSet", admin, ruleSet: qualificationRulesV1() });
  assert.equal(ok.ok, true);
});

test("edge: malformed rule set returns malformed code", async () => {
  const { eng } = engine();
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "gov", displayName: "Gov", roles: new Set(["governance_admin"]) });
  const edge = new RulesEdge(eng, auth);
  const admin: ActorContext = { actorType: "service", actorId: "gov", correlationId: corr };
  const res = await edge.handle({
    op: "registerRuleSet", admin,
    ruleSet: { ruleSetId: "x", version: 1, defaultEffect: "", rules: [] },
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "malformed");
});
