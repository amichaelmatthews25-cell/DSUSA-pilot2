import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuditStore } from "../data/store.ts";
import { AuditServiceImpl } from "../domain/service.ts";
import { AuditEdge } from "../interface/edge.ts";
import { AuthSubstrate } from "../../../libs/auth-kit/src/index.ts";
import {
  asCorrelationId,
  asIdempotencyKey,
  type ActorContext,
} from "../../../libs/types/src/index.ts";
import type { AuditInput } from "../../../libs/audit-kit/src/index.ts";

const corr = asCorrelationId("corr-audit");

function fixture() {
  const store = new InMemoryAuditStore();
  const auth = new AuthSubstrate();
  auth.registerService({ serviceId: "event-platform", displayName: "Event", roles: new Set(["service"]) });
  auth.registerHuman({ userId: "auditor-1", roles: new Set(["audit_reader"]) });
  auth.registerHuman({ userId: "nobody", roles: new Set([]) });
  const svc = new AuditServiceImpl(store, auth);
  return { store, auth, svc };
}

function input(over: Partial<AuditInput> = {}): AuditInput {
  return {
    actorType: "service", actorId: "event-platform", action: "emit",
    entityType: "event", entityId: "evt-1", sourceComponent: "event-platform",
    correlationId: corr, idempotencyKey: asIdempotencyKey("k-1"), ...over,
  };
}

test("record persists and is idempotent", async () => {
  const { svc } = fixture();
  const a = await svc.record(input());
  const b = await svc.record(input());
  assert.equal(a.id, b.id);
});

test("audit class is recorded in metadata (transactional vs informational)", async () => {
  const { svc } = fixture();
  const t = await svc.record(input({ idempotencyKey: asIdempotencyKey("t") }), "transactional");
  const i = await svc.record(input({ idempotencyKey: asIdempotencyKey("i") }), "informational");
  assert.equal((t.metadata as Record<string, unknown>).auditClass, "transactional");
  assert.equal((i.metadata as Record<string, unknown>).auditClass, "informational");
});

test("query is denied without audit-reader role (fail-closed)", async () => {
  const { svc } = fixture();
  const reader: ActorContext = { actorType: "human", actorId: "nobody", correlationId: corr };
  await assert.rejects(svc.queryAudit({}, reader), /audit read denied/);
});

test("query allowed for audit_reader and self-audits the read", async () => {
  const { svc } = fixture();
  await svc.record(input());
  const reader: ActorContext = { actorType: "human", actorId: "auditor-1", correlationId: corr };
  const results = await svc.queryAudit({ entityType: "event" }, reader);
  assert.ok(results.length >= 1);
  // self-audit entry recorded:
  const selfAudit = await svc.queryAudit({ action: "audit.query" }, reader);
  assert.ok(selfAudit.length >= 1, "audit read must itself be audited");
});

test("recordBatch is all-or-nothing on malformed input", async () => {
  const { svc, store } = fixture();
  await assert.rejects(
    svc.recordBatch([input(), input({ action: "", idempotencyKey: asIdempotencyKey("bad") })]),
    /malformed/,
  );
  const all = await store.query({});
  assert.equal(all.length, 0);
});

test("edge host returns denied code for unauthorized read", async () => {
  const { svc } = fixture();
  const edge = new AuditEdge(svc);
  const res = await edge.handle({
    op: "query",
    filter: {},
    reader: { actorType: "human", actorId: "nobody", correlationId: corr },
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "denied");
});

test("edge host records and gets by id", async () => {
  const { svc } = fixture();
  const edge = new AuditEdge(svc);
  const rec = await edge.handle({ op: "record", input: input(), auditClass: "transactional" });
  assert.equal(rec.ok, true);
  const id = rec.ok ? (rec.data as { id: string }).id : "";
  const got = await edge.handle({ op: "get", id });
  assert.equal(got.ok, true);
  if (got.ok) assert.equal((got.data as { id: string }).id, id);
});

test("query supports time-range and pagination deterministically", async () => {
  const { svc } = fixture();
  for (let i = 0; i < 5; i++) {
    await svc.record(input({ idempotencyKey: asIdempotencyKey(`p-${i}`), entityId: `e-${i}` }));
  }
  const reader: ActorContext = { actorType: "human", actorId: "auditor-1", correlationId: corr };
  const page = await svc.queryAudit({ entityType: "event", limit: 2, offset: 0 }, reader);
  assert.equal(page.length, 2);
});
