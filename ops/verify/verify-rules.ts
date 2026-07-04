/**
 * verify-rules.ts — Rules Engine (PMS-4) verification + Rules Engine Correctness Review.
 *
 * Part A: assembled-engine invariant verification (runtime behavior).
 * Part B: Rules Engine Correctness Review (static) proving:
 *   - policy remains OUTSIDE the engine (no business vocabulary in engine source);
 *   - deterministic execution / identical inputs -> identical outputs (Part A);
 *   - replay reproduces prior evaluations (Part A);
 *   - multiple versions coexist (Part A);
 *   - no business logic in engine code (static scan);
 *   - no authorization dependency (no import/use of authorization);
 *   - dependency direction correct (no agents/registries/authorization imports).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RulesEngineImpl } from "../../platform/rules/domain/engine.ts";
import {
  InMemoryRuleSetRegistry,
  InMemoryEvaluationLog,
} from "../../platform/rules/data/store.ts";
import { InMemoryAuditSink } from "../../libs/audit-kit/src/index.ts";
import { asCorrelationId } from "../../libs/types/src/index.ts";
import type { RuleSet } from "../../contracts/src/rules.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const corr = asCorrelationId("verify-rules");

type Check = { name: string; pass: boolean };
const checks: Check[] = [];
const check = (n: string, p: boolean) => checks.push({ name: n, pass: p });

const rsV1: RuleSet = {
  ruleSetId: "rs", version: 1, defaultEffect: "APPROVE",
  rules: [{ id: "floor", description: "", condition: { kind: "cmp", op: "lt", left: { kind: "input", path: "score" }, right: { kind: "lit", value: 600 } }, effect: "DENY", reason: "low" }],
};
const rsV2: RuleSet = { ...rsV1, version: 2, rules: [{ ...rsV1.rules[0]!, condition: { kind: "cmp", op: "lt", left: { kind: "input", path: "score" }, right: { kind: "lit", value: 650 } } }] };

async function partA(): Promise<void> {
  const eng = new RulesEngineImpl(new InMemoryRuleSetRegistry(), new InMemoryEvaluationLog(), new InMemoryAuditSink());
  eng.registerRuleSet(rsV1);
  eng.registerRuleSet(rsV2);

  const a = await eng.evaluate({ ruleSetId: "rs", version: 1, inputs: { score: 720 }, correlationId: corr });
  const b = await eng.evaluate({ ruleSetId: "rs", version: 1, inputs: { score: 720 }, correlationId: corr });
  check("deterministic: identical inputs => identical outputs", a.resolvedEffect === b.resolvedEffect && a.resolvedEffect === "APPROVE");

  const orig = await eng.evaluate({ ruleSetId: "rs", version: 1, inputs: { score: 500 }, correlationId: corr });
  const rep = await eng.replay(orig.evaluationId);
  check("replay reproduces prior evaluation", rep.matches === true);

  const v1 = await eng.evaluate({ ruleSetId: "rs", version: 1, inputs: { score: 620 }, correlationId: corr });
  const v2 = await eng.evaluate({ ruleSetId: "rs", version: 2, inputs: { score: 620 }, correlationId: corr });
  check("versions coexist (v1 APPROVE, v2 DENY for score=620)", v1.resolvedEffect === "APPROVE" && v2.resolvedEffect === "DENY");

  const log = new InMemoryEvaluationLog();
  const eng2 = new RulesEngineImpl(new InMemoryRuleSetRegistry(), log, new InMemoryAuditSink());
  eng2.registerRuleSet(rsV1);
  await eng2.evaluate({ ruleSetId: "rs", version: 1, inputs: { score: 720 }, correlationId: corr, dryRun: true });
  check("dry-run mutates no evaluation log", (await log.count()) === 0);
}

function partB(): void {
  // Scan CODE ONLY — strip line + block comments so documentation that NAMES a prohibition
  // (e.g. "never calls Authorization", "no knowledge of partners") is not mistaken for a violation.
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const engineSrc = stripComments(readFileSync(join(root, "platform/rules/domain/engine.ts"), "utf8"));
  const evalSrc = stripComments(readFileSync(join(root, "platform/rules/domain/evaluator.ts"), "utf8"));
  const dataSrc = stripComments(readFileSync(join(root, "platform/rules/data/store.ts"), "utf8"));
  const allSrc = engineSrc + "\n" + evalSrc + "\n" + dataSrc;

  // No authorization dependency anywhere in the engine.
  check("CR: no authorization import in engine",
    !/authorization/i.test(engineSrc) && !/authorization/i.test(evalSrc));

  // No business-table access: engine must not reference business entity tables or a raw SQL client.
  const businessTables = /(partner|operator|vehicle|load|application|qualification)_[a-z_]*\b\s*(table|FROM|INSERT|UPDATE)/i;
  check("CR: engine reads/writes no business tables", !businessTables.test(allSrc));

  // No business vocabulary baked into the interpreter (it must be generic). The evaluator should not
  // mention domain nouns as identifiers/strings.
  const domainVocab = /\b(partner|operator|vehicle|freight|load|standing|eligibility|creditScore|applicant)\b/;
  check("CR: interpreter contains no business vocabulary (policy stays in data)", !domainVocab.test(evalSrc));

  // Dependency direction: rules imports no agents/registries/authorization/event-domain.
  const badImports = /from "\.\.\/\.\.\/(agents|registries)\//.test(allSrc) ||
    /authorization\/(domain|data|interface)/.test(allSrc) ||
    /event\/domain/.test(allSrc);
  check("CR: rules depends on no agents/registries/authorization/event-domain", !badImports);

  // Engine ships no rule data: there must be no concrete RuleSet literal with rules in engine/evaluator.
  const shipsRules = /ruleSetId:\s*["'][a-z_]+["']/i.test(engineSrc) || /ruleSetId:\s*["'][a-z_]+["']/i.test(evalSrc);
  check("CR: engine ships no rule-set data (policy is external)", !shipsRules);

  // Immutability + append-only present in migration.
  const migrations = readdirSync(join(root, "db/migrations")).filter((f) => f.includes("rules") && !f.includes("down"));
  const mig = migrations.length ? readFileSync(join(root, "db/migrations", migrations[0]!), "utf8").toLowerCase() : "";
  check("CR: rule_set immutable + rule_evaluation append-only (migration)",
    /rule_set versions are immutable/i.test(mig) && /rule_evaluation is append-only/i.test(mig));
}

async function main(): Promise<void> {
  await partA();
  partB();
  const passed = checks.filter((c) => c.pass).length;
  console.log("=== DSUSA Rules Engine (PMS-4) Verification + Correctness Review ===");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  console.log("------------------------------------------------------------------");
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
}
main().catch((e) => { console.error("verification crashed:", e); process.exit(1); });
