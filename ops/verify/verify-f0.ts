/**
 * verify-f0.ts — F0 implementation verification.
 *
 * Exercises the F0 substrate end-to-end and asserts the constitutional invariants F0 is responsible
 * for, producing a human-readable PASS/FAIL report. This is the "implementation verification"
 * deliverable for stage F0 (distinct from unit tests: it proves the assembled substrate behaves).
 */
import { AuthSubstrate, serviceActor } from "../../libs/auth-kit/src/index.ts";
import { InMemoryAuditSink } from "../../libs/audit-kit/src/index.ts";
import {
  InMemoryIdempotencyStore,
  idempotent,
} from "../../libs/idempotency-kit/src/index.ts";
import {
  asCorrelationId,
  asIdempotencyKey,
  newOpaqueId,
} from "../../libs/types/src/index.ts";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  checks.push({ name, pass, detail });
}

async function main(): Promise<void> {
  const corr = asCorrelationId(newOpaqueId());

  // 1. Auth substrate: fail-closed for unknown principals.
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "event-platform", displayName: "Event", roles: new Set(["service"]) });
  check(
    "auth: known service allowed",
    auth.requireRole(serviceActor("event-platform", corr), "service").allowed === true,
  );
  check(
    "auth: unknown principal denied (fail-closed)",
    auth.requireRole(serviceActor("unknown", corr), "service").allowed === false,
  );
  check(
    "auth: ai actor cannot hold roles (structural non-authority)",
    auth.requireRole({ actorType: "ai", actorId: "event-platform", correlationId: corr }, "service")
      .allowed === false,
  );

  // 2. Audit: append-only + idempotent + no mutate API.
  const audit = new InMemoryAuditSink();
  const key = asIdempotencyKey("verify-1");
  const e1 = await audit.record({
    actorType: "service", actorId: "event-platform", action: "emit",
    entityType: "event", entityId: "evt-1", sourceComponent: "event-platform",
    correlationId: corr, idempotencyKey: key,
  });
  const e2 = await audit.record({
    actorType: "service", actorId: "event-platform", action: "emit",
    entityType: "event", entityId: "evt-1", sourceComponent: "event-platform",
    correlationId: corr, idempotencyKey: key,
  });
  check("audit: idempotent write (same key => same entry)", e1.id === e2.id && audit.size === 1);
  check(
    "audit: no update/delete API exists (append-only structural)",
    typeof (audit as unknown as { update?: unknown }).update === "undefined" &&
      typeof (audit as unknown as { delete?: unknown }).delete === "undefined",
  );

  // 3. Idempotency kit: op runs once under repeat + concurrency.
  const store = new InMemoryIdempotencyStore<number>();
  let calls = 0;
  const ik = asIdempotencyKey("op-1");
  await idempotent(store, "verify", ik, async () => { calls++; return 1; });
  await idempotent(store, "verify", ik, async () => { calls++; return 2; });
  check("idempotency: op executes exactly once on repeat", calls === 1);

  const store2 = new InMemoryIdempotencyStore<number>();
  let calls2 = 0;
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      idempotent(store2, "verify", asIdempotencyKey("race"), async () => { calls2++; return calls2; }),
    ),
  );
  check("idempotency: concurrent callers converge to one result", new Set(results).size === 1);

  // 4. Opaque ids are unique + meaningless.
  const ids = new Set(Array.from({ length: 1000 }, () => newOpaqueId()));
  check("types: opaque ids unique across 1000 draws", ids.size === 1000);

  // Report
  const passed = checks.filter((c) => c.pass).length;
  console.log("=== DSUSA F0 Implementation Verification ===");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
  }
  console.log(`--------------------------------------------`);
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((err) => {
  console.error("verification crashed:", err);
  process.exit(1);
});
