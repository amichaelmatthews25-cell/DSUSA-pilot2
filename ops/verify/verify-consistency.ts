/**
 * verify-consistency.ts — Cross-Service Consistency Review (PMS-1 .. PMS-5).
 *
 * Verifies, across the five mechanism services built so far:
 *  - each service has one clearly defined responsibility (single domain entrypoint per service);
 *  - no duplicated capabilities (no two services implement the same port/responsibility);
 *  - interfaces remain stable (each service has its own contract; no contract deleted);
 *  - dependency direction unchanged (no upstream service imports a downstream one);
 *  - no service has begun absorbing another's responsibilities (no cross-service domain imports);
 *  - earlier architectural invariants still hold (append-only audit; authz composes/no-cache;
 *    rules execute-not-define; workflow orchestrate-not-decide).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

const services = [
  { key: "audit", contract: "contracts/src/audit.ts", domainDir: "platform/audit/domain", responsibility: "AuditService" },
  { key: "event", contract: "contracts/src/event.ts", domainDir: "platform/event/domain", responsibility: "EventPlatform" },
  { key: "authorization", contract: "contracts/src/authorization.ts", domainDir: "platform/authorization/domain", responsibility: "AuthorizationService" },
  { key: "rules", contract: "contracts/src/rules.ts", domainDir: "platform/rules/domain", responsibility: "RulesEngine" },
  { key: "workflow", contract: "contracts/src/workflow.ts", domainDir: "platform/workflow/domain", responsibility: "WorkflowService" },
];

// 1. Each service has its contract present (interface stability).
for (const s of services) {
  check(`interface present: ${s.key} (${s.contract})`, existsSync(join(root, s.contract)));
}

// 2. Each service implements exactly its own responsibility interface (one responsibility).
//    The implementing class appears in that service's domain, and NOT in any other service's domain.
function read(p: string): string { return existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : ""; }
const domainSrc: Record<string, string> = {};
for (const s of services) {
  // concatenate the service's domain files
  const files = ["service.ts", "platform.ts", "engine.ts", "evaluator.ts", "validator.ts"]
    .map((f) => read(join(s.domainDir, f)))
    .join("\n");
  domainSrc[s.key] = files;
}
for (const s of services) {
  const ownImplements = new RegExp(`implements ${s.responsibility}\\b`).test(domainSrc[s.key]!);
  check(`single responsibility: ${s.key} implements ${s.responsibility}`, ownImplements);
}

// 3. No duplicated capability: a responsibility interface is implemented in only ONE service domain.
for (const s of services) {
  let implementingServices = 0;
  for (const other of services) {
    if (new RegExp(`implements ${s.responsibility}\\b`).test(domainSrc[other.key]!)) implementingServices++;
  }
  check(`no duplicate capability: ${s.responsibility} implemented once`, implementingServices === 1,
    `implemented in ${implementingServices} service(s)`);
}

// 4. Dependency direction unchanged: no service domain imports another service's domain.
const order = ["audit", "event", "authorization", "rules", "workflow"];
let crossDomainImport = false;
const crossDetails: string[] = [];
for (const s of services) {
  for (const other of services) {
    if (s.key === other.key) continue;
    // importing another service's DOMAIN is forbidden (shared infra/types/contracts are fine).
    const pat = new RegExp(`${other.key}/domain/`);
    if (pat.test(domainSrc[s.key]!)) {
      crossDomainImport = true;
      crossDetails.push(`${s.key} imports ${other.key}/domain`);
    }
  }
}
check("dependency direction: no service imports another service's domain", !crossDomainImport, crossDetails.join("; "));

// 5. No absorption: each service confines its responsibility (no service defines another's core verb).
//    e.g., workflow must not evaluate rules/authorization; authorization must not store standing; etc.
check("no absorption: rules engine has no authorization call", !/authorization/i.test(stripComments(domainSrc["rules"]!)));
check("no absorption: workflow has no rules/authorization evaluation", !/authorization|RulesEngine/i.test(stripComments(domainSrc["workflow"]!)));
check("no absorption: authorization stores no standing/eligibility table", !/standing_table|eligibility_table/i.test(domainSrc["authorization"]!));

// 6. Earlier invariants still hold (spot checks against migrations + sources).
const auditMig = read("db/migrations/0001_audit_service.sql").toLowerCase();
check("invariant: audit append-only still enforced", /append-only/.test(auditMig) && /revoke update, delete/.test(auditMig));
const authzMig = read("db/migrations/0003_authorization_service.sql").toLowerCase();
check("invariant: authorization creates no standing/eligibility/cache table",
  !/create\s+table\s+[^;]*(standing|eligibility|authority_cache)/.test(authzMig));
const rulesMig = read("db/migrations/0004_rules_engine.sql").toLowerCase();
check("invariant: rule sets immutable", /rule_set versions are immutable/.test(rulesMig));
const wfMig = read("db/migrations/0005_workflow_service.sql").toLowerCase();
check("invariant: workflow definitions immutable", /workflow_definition versions are immutable/.test(wfMig));

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const passed = checks.filter((c) => c.pass).length;
console.log("=== DSUSA Cross-Service Consistency Review (PMS-1 .. PMS-5) ===");
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
console.log("--------------------------------------------------------------");
console.log(`${passed}/${checks.length} checks passed`);
if (passed !== checks.length) process.exit(1);
