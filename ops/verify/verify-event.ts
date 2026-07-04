/**
 * verify-event.ts — Event Platform (PMS-2) implementation verification.
 * Proves the assembled service honors its spec invariants end-to-end.
 */
import { InMemoryEventStore } from "../../platform/event/data/store.ts";
import { EventPlatformImpl } from "../../platform/event/domain/platform.ts";
import { InMemoryAuditSink } from "../../libs/audit-kit/src/index.ts";
import {
  asCorrelationId,
  asIdempotencyKey,
  newOpaqueId,
} from "../../libs/types/src/index.ts";

type Check = { name: string; pass: boolean };
const checks: Check[] = [];
const check = (name: string, pass: boolean) => checks.push({ name, pass });
const silent = { info() {}, warn() {}, error() {} };

async function main(): Promise<void> {
  const corr = asCorrelationId(newOpaqueId());
  const store = new InMemoryEventStore();
  const audit = new InMemoryAuditSink();
  const platform = new EventPlatformImpl(store, audit, { logger: silent, retry: { maxAttempts: 2, leaseMs: 0 } });

  const emit = (idem: string) => ({
    eventType: "load.completed", eventVersion: 1, producerComponent: "freight",
    payload: { loadId: "L-1" }, correlationId: corr, idempotencyKey: asIdempotencyKey(idem),
  });

  // 1. Producer-idempotent enqueue.
  const a = await platform.emitEvent(emit("k1"));
  const b = await platform.emitEvent(emit("k1"));
  check("producer-idempotent enqueue (same key => same event)", a.eventId === b.eventId);

  // 2. Enqueue audited as transactional.
  check("enqueue writes transactional audit",
    audit.query({ action: "event.enqueued" }).some(
      (e) => (e.metadata as Record<string, unknown>).auditClass === "transactional"));

  // 3. At-least-once + exactly-once effect.
  let count = 0;
  platform.subscribe({ consumer: "settlement", eventTypes: ["load.completed"] }, async () => { count++; });
  await platform.deliverPending();
  await platform.deliverPending();
  check("delivery de-dups per consumer (exactly-once effect)", count === 1);

  // 4. Dead-letter after exhaustion.
  platform.subscribe({ consumer: "flaky", eventTypes: ["load.failed"] }, async () => { throw new Error("x"); });
  await platform.emitEvent({ ...emit("k2"), eventType: "load.failed" });
  await platform.deliverPending();
  await platform.deliverPending();
  check("dead-letter after maxAttempts", (await store.deadLetters()).length === 1);

  // 5. Unmapped outcome fails closed.
  let unmapped = false;
  try {
    await platform.declareOutcome({
      outcomeKey: "x", producerComponent: "freight", payload: {}, correlationId: corr,
      idempotencyKey: asIdempotencyKey("o1"),
    });
  } catch { unmapped = true; }
  check("unmapped outcome fails closed", unmapped);

  // 6. Replay is de-dup safe.
  const n = await platform.replay({ eventType: "load.completed" });
  check("replay de-dups (no double effect)", n === 0 && count === 1);

  const passed = checks.filter((c) => c.pass).length;
  console.log("=== DSUSA Event Platform (PMS-2) Verification ===");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  console.log("------------------------------------------------");
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => { console.error("verification crashed:", e); process.exit(1); });
