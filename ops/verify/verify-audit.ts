/**
 * verify-audit.ts — Audit Service (PMS-1) implementation verification.
 * Proves the assembled service honors its spec invariants end-to-end.
 */
import { InMemoryAuditStore } from "../../platform/audit/data/store.ts";
import { AuditServiceImpl } from "../../platform/audit/domain/service.ts";
import { AuditEdge } from "../../platform/audit/interface/edge.ts";
import { AuthSubstrate } from "../../libs/auth-kit/src/index.ts";
import {
  asCorrelationId,
  asIdempotencyKey,
  newOpaqueId,
  type ActorContext,
} from "../../libs/types/src/index.ts";

type Check = { name: string; pass: boolean };
const checks: Check[] = [];
const check = (name: string, pass: boolean) => checks.push({ name, pass });

async function main(): Promise<void> {
  const corr = asCorrelationId(newOpaqueId());
  const store = new InMemoryAuditStore();
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "rules-engine", displayName: "Rules", roles: new Set(["service"]) });
  auth.registerHuman({ userId: "auditor", roles: new Set(["audit_reader"]) });
  auth.registerHuman({ userId: "intruder", roles: new Set([]) });
  const svc = new AuditServiceImpl(store, auth);
  const edge = new AuditEdge(svc);

  const base = {
    actorType: "service" as const, actorId: "rules-engine", action: "evaluate",
    entityType: "rule", entityId: "r-1", sourceComponent: "rules-engine", correlationId: corr,
  };

  // 1. Idempotent write.
  const k = asIdempotencyKey("v-1");
  const a = await svc.record({ ...base, idempotencyKey: k });
  const b = await svc.record({ ...base, idempotencyKey: k });
  check("idempotent write (same key => same entry)", a.id === b.id);

  // 2. Audit class recorded.
  const t = await svc.record({ ...base, idempotencyKey: asIdempotencyKey("v-tx") }, "transactional");
  check("transactional class recorded in metadata",
    (t.metadata as Record<string, unknown>).auditClass === "transactional");

  // 3. Read fail-closed without role.
  const intruder: ActorContext = { actorType: "human", actorId: "intruder", correlationId: corr };
  let denied = false;
  try { await svc.queryAudit({}, intruder); } catch { denied = true; }
  check("read denied without audit_reader role (fail-closed)", denied);

  // 4. Read allowed for auditor + self-audited.
  const auditor: ActorContext = { actorType: "human", actorId: "auditor", correlationId: corr };
  await svc.queryAudit({ entityType: "rule" }, auditor);
  const selfAudit = await svc.queryAudit({ action: "audit.query" }, auditor);
  check("audit read is itself audited (self-audit)", selfAudit.length >= 1);

  // 5. Batch all-or-nothing.
  let batchRejected = false;
  try {
    await svc.recordBatch([
      { ...base, idempotencyKey: asIdempotencyKey("ok") },
      { ...base, action: "", idempotencyKey: asIdempotencyKey("bad") },
    ]);
  } catch { batchRejected = true; }
  check("batch all-or-nothing on malformed", batchRejected);

  // 6. Edge denied code.
  const res = await edge.handle({ op: "query", filter: {}, reader: intruder });
  check("edge returns denied code for unauthorized read", res.ok === false && res.code === "denied");

  // 7. No mutate API on the store (append-only structural).
  check("store exposes no update/delete (append-only)",
    typeof (store as unknown as { update?: unknown }).update === "undefined" &&
    typeof (store as unknown as { delete?: unknown }).delete === "undefined");

  const passed = checks.filter((c) => c.pass).length;
  console.log("=== DSUSA Audit Service (PMS-1) Verification ===");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`-----------------------------------------------`);
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => { console.error("verification crashed:", e); process.exit(1); });
