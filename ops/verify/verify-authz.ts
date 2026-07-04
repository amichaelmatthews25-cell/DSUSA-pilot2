/**
 * verify-authz.ts — Authorization Service (PMS-3) implementation verification
 * AND the Authorization Correctness Review (constitutional checks).
 *
 * Part A: assembled-service invariant verification (runtime behavior).
 * Part B: Authorization Correctness Review — static checks over the source + migration text proving:
 *   - no authorization state is stored (no standing/eligibility/cache tables in migration 0003);
 *   - no enforcement cache exists (decision log has no subject-keyed read; isAuthorized never reads log);
 *   - every consumed fact has exactly one authoritative producer (single-producer guard present);
 *   - every decision is reproducible / audited / fails closed (covered by Part A);
 *   - dependency direction remains correct (authorization imports no agents/registries/event-domain).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthorizationServiceImpl, reproduceDecision } from "../../platform/authorization/domain/service.ts";
import { InMemoryDecisionLog } from "../../platform/authorization/data/decision-log.ts";
import { InMemoryAuditSink } from "../../libs/audit-kit/src/index.ts";
import { asCorrelationId } from "../../libs/types/src/index.ts";
import type { CapabilityDefinition, FactProvider } from "../../contracts/src/authorization.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

type Check = { name: string; pass: boolean };
const checks: Check[] = [];
const check = (name: string, pass: boolean) => checks.push({ name, pass });

const corr = asCorrelationId("verify-authz");

const cap: CapabilityDefinition = {
  code: "post_loads", description: "x", requiredFactTypes: ["partner.standing"], version: 1, isActive: true,
  compose: (f) => {
    const ok = f["partner.standing"]?.value === "in_good_standing";
    return { allowed: ok, explanation: ok ? "ok" : "blocked" };
  },
};
function provider(value: string, asOf?: string): FactProvider {
  return {
    factType: "partner.standing", producingService: "partner-governance",
    async getFact(subjectId) {
      return { factType: "partner.standing", producingService: "partner-governance", value, asOf: asOf ?? new Date().toISOString(), subjectId };
    },
  };
}

async function partA(): Promise<void> {
  // allow
  {
    const svc = new AuthorizationServiceImpl(new InMemoryDecisionLog(), new InMemoryAuditSink());
    svc.defineCapability(cap); svc.registerFactProvider(provider("in_good_standing"));
    const d = await svc.isAuthorized({ actorType: "service", actorId: "freight", capability: "post_loads", subjectId: "p1", correlationId: corr });
    check("composition allow", d.allowed === true);
    check("decision carries producing services + rules version + audit ref",
      d.producingServices.length === 1 && d.rulesVersion === 1 && d.auditRef.length > 0);
  }
  // fail-closed: unavailable
  {
    const svc = new AuthorizationServiceImpl(new InMemoryDecisionLog(), new InMemoryAuditSink());
    svc.defineCapability(cap);
    svc.registerFactProvider({ factType: "partner.standing", producingService: "partner-governance", async getFact() { throw new Error("down"); } });
    const d = await svc.isAuthorized({ actorType: "service", actorId: "freight", capability: "post_loads", subjectId: "p1", correlationId: corr });
    check("fail-closed on provider unavailable", d.allowed === false);
  }
  // fail-closed: timeout
  {
    const svc = new AuthorizationServiceImpl(new InMemoryDecisionLog(), new InMemoryAuditSink(), { factTimeoutMs: 10 });
    svc.defineCapability(cap);
    svc.registerFactProvider({ factType: "partner.standing", producingService: "partner-governance", async getFact(s) { await new Promise(r => setTimeout(r, 100)); return { factType: "partner.standing", producingService: "partner-governance", value: "in_good_standing", asOf: new Date().toISOString(), subjectId: s }; } });
    const d = await svc.isAuthorized({ actorType: "service", actorId: "freight", capability: "post_loads", subjectId: "p1", correlationId: corr });
    check("fail-closed on provider timeout", d.allowed === false && d.reasons.some(r => r.startsWith("fact_timeout")));
  }
  // fail-closed: stale
  {
    const svc = new AuthorizationServiceImpl(new InMemoryDecisionLog(), new InMemoryAuditSink(), { defaultMaxStalenessMs: 500 });
    svc.defineCapability(cap); svc.registerFactProvider(provider("in_good_standing", new Date(Date.now() - 10000).toISOString()));
    const d = await svc.isAuthorized({ actorType: "service", actorId: "freight", capability: "post_loads", subjectId: "p1", correlationId: corr });
    check("fail-closed on stale fact", d.allowed === false && d.reasons.some(r => r.startsWith("stale_fact")));
  }
  // no enforcement cache
  {
    const svc = new AuthorizationServiceImpl(new InMemoryDecisionLog(), new InMemoryAuditSink());
    svc.defineCapability(cap);
    let standing = "in_good_standing";
    svc.registerFactProvider({ factType: "partner.standing", producingService: "partner-governance", async getFact(s) { return { factType: "partner.standing", producingService: "partner-governance", value: standing, asOf: new Date().toISOString(), subjectId: s }; } });
    const a = await svc.isAuthorized({ actorType: "service", actorId: "freight", capability: "post_loads", subjectId: "p1", correlationId: corr });
    standing = "suspended";
    const b = await svc.isAuthorized({ actorType: "service", actorId: "freight", capability: "post_loads", subjectId: "p1", correlationId: corr });
    check("no enforcement cache (fact change reflected next decision)", a.allowed === true && b.allowed === false);
  }
  // reproducible + audited
  {
    const log = new InMemoryDecisionLog(); const audit = new InMemoryAuditSink();
    const svc = new AuthorizationServiceImpl(log, audit);
    svc.defineCapability(cap); svc.registerFactProvider(provider("in_good_standing"));
    const d = await svc.isAuthorized({ actorType: "service", actorId: "freight", capability: "post_loads", subjectId: "p1", correlationId: corr });
    const recorded = await log.getForAudit(d.decisionId);
    const rep = recorded ? reproduceDecision(recorded, cap) : { matches: false };
    check("decision reproducible from recorded facts", rep.matches === true);
    check("decision audited", audit.query({ action: "authorization.decided" }).length === 1);
  }
}

function partB(): void {
  // --- Authorization Correctness Review (static) ---
  const migration = readFileSync(join(root, "db/migrations/0003_authorization_service.sql"), "utf8").toLowerCase();
  // no standing/eligibility/cache TABLES created by authorization
  const createsForbidden = /create\s+table\s+[^;]*(standing|eligibility|authority_cache|enforcement_cache)/.test(migration);
  check("CR: no standing/eligibility/cache table created in authorization migration", !createsForbidden);

  const decisionLogSrc = readFileSync(join(root, "platform/authorization/data/decision-log.ts"), "utf8");
  // no subject-keyed "latest decision" read that could be an enforcement cache.
  // Scan only method/function-defining lines (ignore comments that may DOCUMENT the absence of such a read).
  const codeLines = decisionLogSrc
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"));
  const hasSubjectRead = codeLines.some((l) =>
    /\b(getLatestDecisionFor|getDecisionForSubject|latestFor|readBySubject|forSubject)\s*\(/.test(l),
  );
  check("CR: decision log has no subject-keyed read (no enforcement-cache surface)", !hasSubjectRead);

  const serviceSrc = readFileSync(join(root, "platform/authorization/domain/service.ts"), "utf8");
  // isAuthorized must not read the decision log (log is append/getForAudit only; never consulted to decide)
  const readsLogToDecide = /log\.(getForAudit|count)\s*\([^)]*\)[^;]*;?\s*[^]*?isAuthorized/i;
  // simpler: ensure within isAuthorized body there is no this.log.get call — check ordering by locating method
  const isAuthBody = serviceSrc.slice(serviceSrc.indexOf("async isAuthorized"), serviceSrc.indexOf("// ---- internals ----"));
  check("CR: isAuthorized never reads the decision log", !/this\.log\.(getForAudit|count)/.test(isAuthBody));

  // single producer guard present
  check("CR: single-producer-per-fact guard present", /DuplicateProducerError/.test(serviceSrc) && /already has authoritative producer/.test(serviceSrc));

  // dependency direction: authorization imports no agents/registries/event-domain
  const importsBad = /from "\.\.\/\.\.\/(agents|registries)\//.test(serviceSrc) ||
    /event\/domain/.test(serviceSrc);
  check("CR: authorization depends on no downstream agents/registries", !importsBad);

  // append-only enforcement present in migration
  check("CR: decision log is append-only (revoke update/delete + trigger)",
    /revoke\s+update,\s*delete/.test(migration) && /append-only/.test(migration));
}

async function main(): Promise<void> {
  await partA();
  partB();
  const passed = checks.filter((c) => c.pass).length;
  console.log("=== DSUSA Authorization Service (PMS-3) Verification + Correctness Review ===");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  console.log("---------------------------------------------------------------------------");
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
}
main().catch((e) => { console.error("verification crashed:", e); process.exit(1); });
