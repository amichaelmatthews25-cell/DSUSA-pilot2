import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../data/store.ts";
import { EventPlatformImpl, UnmappedOutcomeError, NOOP_METRICS } from "../domain/platform.ts";
import { EventEdge } from "../interface/edge.ts";
import { InMemoryAuditSink } from "../../../libs/audit-kit/src/index.ts";
import { AuthSubstrate } from "../../../libs/auth-kit/src/index.ts";
import {
  asCorrelationId,
  asIdempotencyKey,
  type ActorContext,
} from "../../../libs/types/src/index.ts";

const corr = asCorrelationId("corr-evt");

function fixture(opts: { retry?: { maxAttempts: number; leaseMs: number } } = {}) {
  const store = new InMemoryEventStore();
  const audit = new InMemoryAuditSink();
  const platform = new EventPlatformImpl(store, audit, {
    metrics: NOOP_METRICS,
    logger: { info() {}, warn() {}, error() {} },
    ...(opts.retry ? { retry: opts.retry } : {}),
  });
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "partner-gov", displayName: "Partner", roles: new Set(["service"]) });
  auth.registerService({ serviceId: "ops", displayName: "Ops", roles: new Set(["platform_admin"]) });
  return { store, audit, platform, auth };
}

function emit(over: Record<string, unknown> = {}) {
  return {
    eventType: "partner.standing_changed",
    eventVersion: 1,
    producerComponent: "partner-gov",
    payload: { partnerId: "p-1" },
    correlationId: corr,
    idempotencyKey: asIdempotencyKey("e-1"),
    ...over,
  };
}

test("emit enqueues durably and is producer-idempotent", async () => {
  const { platform, store } = fixture();
  const a = await platform.emitEvent(emit());
  const b = await platform.emitEvent(emit()); // same idem key
  assert.equal(a.eventId, b.eventId);
  assert.equal(await store.countByStatus("pending"), 1);
});

test("delivery is at-least-once and de-duped per consumer (exactly-once effect)", async () => {
  const { platform } = fixture();
  let count = 0;
  platform.subscribe({ consumer: "freight", eventTypes: ["partner.standing_changed"] }, async () => { count++; });
  await platform.emitEvent(emit());
  await platform.deliverPending();
  await platform.deliverPending(); // re-run; already delivered/processed -> no double effect
  assert.equal(count, 1);
});

test("failing consumer triggers retry then dead-letter after maxAttempts", async () => {
  const { platform, store } = fixture({ retry: { maxAttempts: 2, leaseMs: 0 } });
  platform.subscribe({ consumer: "flaky", eventTypes: ["partner.standing_changed"] }, async () => {
    throw new Error("boom");
  });
  await platform.emitEvent(emit());
  await platform.deliverPending(); // attempt 1 -> pending
  await platform.deliverPending(); // attempt 2 -> dead_lettered
  const dlq = await store.deadLetters();
  assert.equal(dlq.length, 1);
  assert.equal(await store.countByStatus("dead_lettered"), 1);
});

test("declareOutcome maps to event via active mapping; unmapped fails closed", async () => {
  const { platform } = fixture();
  await assert.rejects(
    platform.declareOutcome({
      outcomeKey: "partner_suspended", producerComponent: "partner-gov",
      payload: { partnerId: "p-1" }, correlationId: corr, idempotencyKey: asIdempotencyKey("o-1"),
    }),
    UnmappedOutcomeError,
  );
  platform.defineMapping({
    outcomeKey: "partner_suspended", producerComponent: "partner-gov",
    eventType: "partner.suspended", eventVersion: 1, isActive: true,
  });
  const events = await platform.declareOutcome({
    outcomeKey: "partner_suspended", producerComponent: "partner-gov",
    payload: { partnerId: "p-1" }, correlationId: corr, idempotencyKey: asIdempotencyKey("o-2"),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.eventType, "partner.suspended");
});

test("replay re-delivers frozen events and de-dups (no double effect)", async () => {
  const { platform } = fixture();
  let delivered = 0;
  platform.subscribe({ consumer: "analytics", eventTypes: ["partner.standing_changed"] }, async () => { delivered++; });
  await platform.emitEvent(emit());
  await platform.deliverPending();
  assert.equal(delivered, 1);
  const n = await platform.replay({ eventType: "partner.standing_changed" });
  assert.equal(n, 0, "already processed -> replay is a no-op effect (de-dup)");
  assert.equal(delivered, 1);
});

test("edge gates production by role (fail-closed)", async () => {
  const { platform, auth } = fixture();
  const edge = new EventEdge(platform, auth);
  const intruder: ActorContext = { actorType: "human", actorId: "ghost", correlationId: corr };
  const res = await edge.handle({ op: "emitEvent", caller: intruder, req: emit() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "denied");
});

test("edge allows replay only for platform_admin", async () => {
  const { platform, auth } = fixture();
  const edge = new EventEdge(platform, auth);
  const svc: ActorContext = { actorType: "service", actorId: "partner-gov", correlationId: corr };
  const denied = await edge.handle({ op: "replay", caller: svc, filter: {} });
  assert.equal(denied.ok, false);
  const ops: ActorContext = { actorType: "service", actorId: "ops", correlationId: corr };
  const allowed = await edge.handle({ op: "replay", caller: ops, filter: {} });
  assert.equal(allowed.ok, true);
});

test("enqueue writes a transactional audit entry", async () => {
  const { platform, audit } = fixture();
  await platform.emitEvent(emit());
  const entries = audit.query({ action: "event.enqueued" });
  assert.equal(entries.length, 1);
  assert.equal((entries[0]!.metadata as Record<string, unknown>).auditClass, "transactional");
});
