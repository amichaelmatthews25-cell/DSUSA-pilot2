/**
 * verify-workflow.ts — Workflow Service (PMS-5) verification + Workflow Correctness Review.
 *
 * Part A: assembled-engine invariant verification (runtime behavior).
 * Part B: Workflow Correctness Review (static) proving orchestration-only, no business decisions,
 *   no embedded workflows, deterministic execution, replay correctness, idempotent resume, correct
 *   delegation boundaries, dependency direction.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WorkflowServiceImpl } from "../../platform/workflow/domain/engine.ts";
import {
  InMemoryWorkflowRegistry,
  InMemoryExecutionStore,
} from "../../platform/workflow/data/store.ts";
import { InMemoryAuditSink } from "../../libs/audit-kit/src/index.ts";
import { asCorrelationId } from "../../libs/types/src/index.ts";
import type { WorkflowDefinition, StepHandler } from "../../contracts/src/workflow.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const corr = asCorrelationId("verify-wf");

type Check = { name: string; pass: boolean };
const checks: Check[] = [];
const check = (n: string, p: boolean) => checks.push({ name: n, pass: p });

const wf: WorkflowDefinition = {
  workflowId: "wf", version: 1,
  steps: [
    { id: "a", action: "A" },
    { id: "b", action: "B", dependsOn: ["a"], compensate: "UNDO_B" },
    { id: "c", action: "C", dependsOn: ["b"] },
  ],
};

function newEngine() {
  return new WorkflowServiceImpl(new InMemoryWorkflowRegistry(), new InMemoryExecutionStore(), new InMemoryAuditSink());
}
function happy(eng: WorkflowServiceImpl, calls?: string[]): void {
  const mk = (n: string): StepHandler => async (ctx) => { calls?.push(`${n}:${ctx.stepId}`); return { status: "ok", output: { n } }; };
  eng.registerStepHandler("A", mk("A"));
  eng.registerStepHandler("B", mk("B"));
  eng.registerStepHandler("C", mk("C"));
}

async function partA(): Promise<void> {
  // deterministic completion
  {
    const eng = newEngine(); eng.registerWorkflow(wf); happy(eng);
    const e = await eng.start({ workflowId: "wf", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k1" });
    check("runs all steps to completion via delegation", e.state === "completed" && e.completedSteps.length === 3);
  }
  // idempotent start
  {
    const eng = newEngine(); eng.registerWorkflow(wf); const calls: string[] = []; happy(eng, calls);
    await eng.start({ workflowId: "wf", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k2" });
    await eng.start({ workflowId: "wf", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k2" });
    check("idempotent start (handlers run once)", calls.length === 3);
  }
  // pause/resume idempotent
  {
    const eng = newEngine(); eng.registerWorkflow(wf); const calls: string[] = [];
    eng.registerStepHandler("A", async (ctx) => { calls.push("A"); await eng.pause(ctx.executionId); return { status: "ok" }; });
    eng.registerStepHandler("B", async () => { calls.push("B"); return { status: "ok" }; });
    eng.registerStepHandler("C", async () => { calls.push("C"); return { status: "ok" }; });
    const paused = await eng.start({ workflowId: "wf", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k3" });
    const [r1, r2] = await Promise.all([eng.resume(paused.executionId), eng.resume(paused.executionId)]);
    check("pause/resume completes; idempotent under duplicate resume",
      r1.state === "completed" && r2.state === "completed" && calls.filter((c) => c === "B").length === 1);
  }
  // retry
  {
    const eng = newEngine();
    eng.registerWorkflow({ workflowId: "r", version: 1, steps: [{ id: "x", action: "X", maxAttempts: 3 }] });
    let n = 0;
    eng.registerStepHandler("X", async () => { n++; return n < 3 ? { status: "retry" } : { status: "ok" }; });
    const e = await eng.start({ workflowId: "r", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k4" });
    check("retry up to maxAttempts then success", e.state === "completed" && n === 3);
  }
  // compensation
  {
    const eng = newEngine(); eng.registerWorkflow(wf); const comp: string[] = [];
    eng.registerStepHandler("A", async () => ({ status: "ok" }));
    eng.registerStepHandler("B", async () => ({ status: "ok" }));
    eng.registerStepHandler("C", async () => ({ status: "fail" }));
    eng.registerCompensation("UNDO_B", async () => { comp.push("undo_b"); });
    const e = await eng.start({ workflowId: "wf", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k5" });
    check("failure compensates completed steps", e.state === "compensated" && comp.length === 1);
  }
  // replay
  {
    const eng = newEngine(); eng.registerWorkflow(wf); happy(eng);
    const e = await eng.start({ workflowId: "wf", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k6" });
    const r = await eng.replay(e.executionId);
    check("replay reproduces deterministic path", r.matches === true);
  }
  // dry-run
  {
    const eng = newEngine(); eng.registerWorkflow(wf); const flags: boolean[] = [];
    const mk = (): StepHandler => async (ctx) => { flags.push(ctx.dryRun); return { status: "ok" }; };
    eng.registerStepHandler("A", mk()); eng.registerStepHandler("B", mk()); eng.registerStepHandler("C", mk());
    const e = await eng.start({ workflowId: "wf", version: 1, inputs: {}, correlationId: corr, idempotencyKey: "k7", dryRun: true });
    check("dry-run propagates dryRun to handlers", e.dryRun === true && flags.every((f) => f));
  }
}

function partB(): void {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const engineSrc = strip(readFileSync(join(root, "platform/workflow/domain/engine.ts"), "utf8"));
  const validatorSrc = strip(readFileSync(join(root, "platform/workflow/domain/validator.ts"), "utf8"));
  const dataSrc = strip(readFileSync(join(root, "platform/workflow/data/store.ts"), "utf8"));
  const all = engineSrc + "\n" + validatorSrc + "\n" + dataSrc;

  // No authorization / rules / AI evaluation inside the engine.
  check("CR: engine evaluates no authorization", !/authorization/i.test(all));
  check("CR: engine evaluates no rules itself", !/\bRulesEngine\b|rules\/domain/i.test(all));
  check("CR: engine calls no AI", !/\bai\b|openai|llm|model\.complete/i.test(all));

  // No business vocabulary baked into engine/validator (orchestration is generic).
  const domainVocab = /\b(partner|operator|vehicle|freight|load|standing|eligibility|applicant|qualification)\b/;
  check("CR: engine/validator contain no business vocabulary", !domainVocab.test(engineSrc) && !domainVocab.test(validatorSrc));

  // No embedded workflow data (engine ships no workflow definitions).
  check("CR: engine ships no embedded workflow definitions", !/workflowId:\s*["'][a-z_]+["']/i.test(engineSrc));

  // No business-table access.
  const businessTables = /(partner|operator|vehicle|load|application)_[a-z_]*\s*(FROM|INSERT|UPDATE|table)/i;
  check("CR: engine reads/writes no business tables", !businessTables.test(all));

  // Dependency direction: workflow imports no agents/registries/authorization/rules/event-domain.
  const badImports = /from "\.\.\/\.\.\/(agents|registries)\//.test(all) ||
    /authorization\/(domain|data|interface)/.test(all) ||
    /rules\/(domain|data|interface)/.test(all) ||
    /event\/domain/.test(all);
  check("CR: workflow depends on no agents/registries/authorization/rules/event-domain", !badImports);

  // Delegation boundary: business work goes through StepHandler (handlers map present).
  check("CR: business work delegated through step handlers", /handlers\.get\(/.test(engineSrc) && /StepHandler/.test(engineSrc));

  // Immutability + resumable state in migration.
  const migs = readdirSync(join(root, "db/migrations")).filter((f) => f.includes("workflow") && !f.includes("down"));
  const mig = migs.length ? readFileSync(join(root, "db/migrations", migs[0]!), "utf8").toLowerCase() : "";
  check("CR: workflow_definition immutable; execution idempotent (migration)",
    /workflow_definition versions are immutable/i.test(mig) && /workflow_execution_idem/i.test(mig));
}

async function main(): Promise<void> {
  await partA();
  partB();
  const passed = checks.filter((c) => c.pass).length;
  console.log("=== DSUSA Workflow Service (PMS-5) Verification + Correctness Review ===");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  console.log("----------------------------------------------------------------------");
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
}
main().catch((e) => { console.error("verification crashed:", e); process.exit(1); });
