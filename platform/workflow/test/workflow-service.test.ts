import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkflowServiceImpl, WorkflowNotFoundError, MissingHandlerError } from "../domain/engine.ts";
import { validateWorkflow, topoOrder, MalformedWorkflowError } from "../domain/validator.ts";
import {
  InMemoryWorkflowRegistry,
  InMemoryExecutionStore,
  ImmutableWorkflowError,
} from "../data/store.ts";
import { WorkflowEdge } from "../interface/edge.ts";
import { InMemoryAuditSink } from "../../../libs/audit-kit/src/index.ts";
import { AuthSubstrate } from "../../../libs/auth-kit/src/index.ts";
import { asCorrelationId, type ActorContext } from "../../../libs/types/src/index.ts";
import type {
  WorkflowDefinition,
  StartRequest,
  StepHandler,
} from "../../../contracts/src/workflow.ts";

const corr = asCorrelationId("corr-wf");

/** A 3-step linear workflow supplied as DATA. */
function onboardingV1(): WorkflowDefinition {
  return {
    workflowId: "operator_onboarding",
    version: 1,
    steps: [
      { id: "verify_docs", action: "VERIFY_DOCS" },
      { id: "provision", action: "PROVISION", dependsOn: ["verify_docs"], compensate: "DEPROVISION" },
      { id: "notify", action: "NOTIFY", dependsOn: ["provision"] },
    ],
  };
}

function engine() {
  const registry = new InMemoryWorkflowRegistry();
  const store = new InMemoryExecutionStore();
  const audit = new InMemoryAuditSink();
  const eng = new WorkflowServiceImpl(registry, store, audit);
  return { registry, store, audit, eng };
}

function startReq(over: Partial<StartRequest> = {}): StartRequest {
  return {
    workflowId: "operator_onboarding", version: 1, inputs: { operatorId: "op-1" },
    correlationId: corr, idempotencyKey: "start-1", ...over,
  };
}

/** Register all handlers as no-op successes unless overridden. */
function registerHappyHandlers(eng: WorkflowServiceImpl, calls?: string[]): void {
  const mk = (name: string): StepHandler => async (ctx) => {
    calls?.push(`${name}:${ctx.stepId}`);
    return { status: "ok", output: { ran: name } };
  };
  eng.registerStepHandler("VERIFY_DOCS", mk("verify"));
  eng.registerStepHandler("PROVISION", mk("provision"));
  eng.registerStepHandler("NOTIFY", mk("notify"));
}

// ---- VALIDATION ----
test("validator rejects cycles and unknown deps", () => {
  assert.throws(() => validateWorkflow({
    workflowId: "c", version: 1,
    steps: [{ id: "a", action: "A", dependsOn: ["b"] }, { id: "b", action: "B", dependsOn: ["a"] }],
  }), MalformedWorkflowError);
  assert.throws(() => validateWorkflow({
    workflowId: "u", version: 1, steps: [{ id: "a", action: "A", dependsOn: ["ghost"] }],
  }), /unknown step/);
});

test("topoOrder is deterministic (deps first, definition order for ties)", () => {
  const order = topoOrder(onboardingV1().steps);
  assert.deepEqual(order, ["verify_docs", "provision", "notify"]);
});

// ---- HAPPY PATH / DELEGATION ----
test("start runs all steps via delegated handlers to completion", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  const calls: string[] = [];
  registerHappyHandlers(eng, calls);
  const exec = await eng.start(startReq());
  assert.equal(exec.state, "completed");
  assert.deepEqual(exec.completedSteps.map((s) => s.stepId), ["verify_docs", "provision", "notify"]);
  assert.deepEqual(calls, ["verify:verify_docs", "provision:provision", "notify:notify"]);
});

test("missing handler is rejected before running (delegation boundary explicit)", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  eng.registerStepHandler("VERIFY_DOCS", async () => ({ status: "ok" }));
  // PROVISION + NOTIFY handlers missing
  await assert.rejects(eng.start(startReq()), MissingHandlerError);
});

// ---- IDEMPOTENT START ----
test("duplicate start (same idempotency key) returns the same execution, no second run", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  const calls: string[] = [];
  registerHappyHandlers(eng, calls);
  const a = await eng.start(startReq());
  const b = await eng.start(startReq()); // same key
  assert.equal(a.executionId, b.executionId);
  assert.equal(calls.length, 3, "handlers ran only once across duplicate starts");
});

// ---- PAUSE / RESUME (idempotent) ----
test("pause then resume completes without re-running completed steps", async () => {
  const { eng, store } = engine();
  eng.registerWorkflow(onboardingV1());
  const calls: string[] = [];
  // verify pauses the execution mid-flight by requesting pause from within the first handler.
  eng.registerStepHandler("VERIFY_DOCS", async (ctx) => {
    calls.push("verify");
    await eng.pause(ctx.executionId); // cooperative pause request
    return { status: "ok", output: {} };
  });
  eng.registerStepHandler("PROVISION", async () => { calls.push("provision"); return { status: "ok" }; });
  eng.registerStepHandler("NOTIFY", async () => { calls.push("notify"); return { status: "ok" }; });

  const paused = await eng.start(startReq());
  assert.equal(paused.state, "paused");
  assert.deepEqual(paused.completedSteps.map((s) => s.stepId), ["verify_docs"]);

  const resumed = await eng.resume(paused.executionId);
  assert.equal(resumed.state, "completed");
  // verify ran once total (not re-run on resume) -> idempotent resume
  assert.equal(calls.filter((c) => c === "verify").length, 1);
  assert.deepEqual(calls, ["verify", "provision", "notify"]);
});

test("resume on a terminal execution is idempotent (no-op)", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  registerHappyHandlers(eng);
  const done = await eng.start(startReq());
  const again = await eng.resume(done.executionId);
  assert.equal(again.state, "completed");
  assert.equal(again.executionId, done.executionId);
});

// ---- RETRY ----
test("step retries up to maxAttempts then succeeds", async () => {
  const def: WorkflowDefinition = {
    workflowId: "retry_wf", version: 1,
    steps: [{ id: "flaky", action: "FLAKY", maxAttempts: 3 }],
  };
  const { eng } = engine();
  eng.registerWorkflow(def);
  let attempts = 0;
  eng.registerStepHandler("FLAKY", async () => {
    attempts++;
    return attempts < 3 ? { status: "retry" } : { status: "ok", output: { attempts } };
  });
  const exec = await eng.start(startReq({ workflowId: "retry_wf", idempotencyKey: "retry-1" }));
  assert.equal(exec.state, "completed");
  assert.equal(attempts, 3);
  assert.equal(exec.completedSteps[0]!.attempts, 3);
});

// ---- COMPENSATION ----
test("failure triggers compensation of completed steps (reverse order)", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  const comp: string[] = [];
  eng.registerStepHandler("VERIFY_DOCS", async () => ({ status: "ok", output: {} }));
  eng.registerStepHandler("PROVISION", async () => ({ status: "ok", output: {} }));
  eng.registerStepHandler("NOTIFY", async () => ({ status: "fail", explanation: "smtp down" }));
  eng.registerCompensation("DEPROVISION", async (ctx) => { comp.push(`deprovision:${ctx.stepId}`); });

  const exec = await eng.start(startReq({ idempotencyKey: "comp-1" }));
  assert.equal(exec.state, "compensated");
  // provision had a compensate hook -> it was rolled back
  assert.deepEqual(comp, ["deprovision:provision"]);
});

// ---- DRY-RUN ----
test("dry-run drives execution with dryRun flag propagated to handlers", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  const flags: boolean[] = [];
  const mk = (): StepHandler => async (ctx) => { flags.push(ctx.dryRun); return { status: "ok" }; };
  eng.registerStepHandler("VERIFY_DOCS", mk());
  eng.registerStepHandler("PROVISION", mk());
  eng.registerStepHandler("NOTIFY", mk());
  const exec = await eng.start(startReq({ dryRun: true, idempotencyKey: "dry-1" }));
  assert.equal(exec.dryRun, true);
  assert.ok(flags.every((f) => f === true), "handlers must see dryRun=true");
});

// ---- VERSION COEXISTENCE ----
test("multiple workflow versions coexist", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  const v2: WorkflowDefinition = { ...onboardingV1(), version: 2, steps: [{ id: "verify_docs", action: "VERIFY_DOCS" }] };
  eng.registerWorkflow(v2);
  assert.deepEqual(eng.versionsOf("operator_onboarding"), [1, 2]);
});

test("re-registering a workflow version is rejected (immutable)", () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  assert.throws(() => eng.registerWorkflow(onboardingV1()), ImmutableWorkflowError);
});

// ---- CONCURRENCY ----
test("concurrent executions are independent and each recorded", async () => {
  const { eng, store } = engine();
  eng.registerWorkflow(onboardingV1());
  registerHappyHandlers(eng);
  const execs = await Promise.all(
    Array.from({ length: 15 }, (_, i) => eng.start(startReq({ idempotencyKey: `c-${i}`, inputs: { operatorId: `op-${i}` } }))),
  );
  assert.equal(new Set(execs.map((e) => e.executionId)).size, 15);
  assert.equal(await store.count(), 15);
});

// ---- DETERMINISTIC REPLAY ----
test("replay reproduces the deterministic step path", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  registerHappyHandlers(eng);
  const exec = await eng.start(startReq({ idempotencyKey: "replay-1" }));
  const { matches, replayedPath } = await eng.replay(exec.executionId);
  assert.equal(matches, true);
  assert.deepEqual(replayedPath, ["verify_docs", "provision", "notify"]);
});

// ---- EXPLANATION CONSISTENCY ----
test("execution explanation reflects terminal state", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  registerHappyHandlers(eng);
  const exec = await eng.start(startReq({ idempotencyKey: "explain-1" }));
  assert.match(exec.explanation, /completed/);
});

// ---- DUPLICATE MESSAGE HANDLING (resume idempotency under duplicate delivery) ----
test("duplicate resume calls do not double-run steps", async () => {
  const { eng } = engine();
  eng.registerWorkflow(onboardingV1());
  const calls: string[] = [];
  eng.registerStepHandler("VERIFY_DOCS", async (ctx) => { calls.push("verify"); await eng.pause(ctx.executionId); return { status: "ok" }; });
  eng.registerStepHandler("PROVISION", async () => { calls.push("provision"); return { status: "ok" }; });
  eng.registerStepHandler("NOTIFY", async () => { calls.push("notify"); return { status: "ok" }; });
  const paused = await eng.start(startReq({ idempotencyKey: "dup-1" }));
  const [r1, r2] = await Promise.all([eng.resume(paused.executionId), eng.resume(paused.executionId)]);
  assert.equal(r1.state, "completed");
  assert.equal(r2.state, "completed");
  assert.equal(calls.filter((c) => c === "provision").length, 1, "provision ran once despite duplicate resume");
});

// ---- EDGE GATING ----
test("edge: registration requires governance/platform admin", async () => {
  const { eng } = engine();
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "gov", displayName: "Gov", roles: new Set(["governance_admin"]) });
  auth.registerService({ serviceId: "svc", displayName: "Svc", roles: new Set(["service"]) });
  const edge = new WorkflowEdge(eng, auth);
  const nonAdmin: ActorContext = { actorType: "service", actorId: "svc", correlationId: corr };
  const admin: ActorContext = { actorType: "service", actorId: "gov", correlationId: corr };
  const denied = await edge.handle({ op: "registerWorkflow", admin: nonAdmin, def: onboardingV1() });
  assert.equal(denied.ok, false);
  const ok = await edge.handle({ op: "registerWorkflow", admin, def: onboardingV1() });
  assert.equal(ok.ok, true);
});
