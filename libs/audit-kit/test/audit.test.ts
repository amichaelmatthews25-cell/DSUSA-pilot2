import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAuditSink,
  AppendOnlyHistory,
  type AuditInput,
} from "../src/index.ts";
import { asCorrelationId, asIdempotencyKey } from "../../types/src/index.ts";

function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    actorType: "service",
    actorId: "rules-engine",
    action: "evaluate",
    entityType: "rule",
    entityId: "r-1",
    sourceComponent: "rules-engine",
    correlationId: asCorrelationId("corr-1"),
    idempotencyKey: asIdempotencyKey("k-1"),
    ...overrides,
  };
}

test("audit record is idempotent: repeated key returns original, no duplicate", async () => {
  const sink = new InMemoryAuditSink();
  const a = await sink.record(input());
  const b = await sink.record(input());
  assert.equal(a.id, b.id);
  assert.equal(sink.size, 1);
});

test("audit entries are immutable (frozen-by-contract; no update/delete API exists)", async () => {
  const sink = new InMemoryAuditSink();
  const e = await sink.record(input());
  // The AuditSink interface exposes no mutate/delete — immutability is structural.
  assert.equal(typeof (sink as unknown as { update?: unknown }).update, "undefined");
  assert.equal(typeof (sink as unknown as { delete?: unknown }).delete, "undefined");
  assert.ok(e.createdAt);
});

test("recordBatch is all-or-nothing on malformed input", async () => {
  const sink = new InMemoryAuditSink();
  await assert.rejects(
    sink.recordBatch([input(), input({ action: "", idempotencyKey: asIdempotencyKey("k-2") })]),
    /malformed/,
  );
  assert.equal(sink.size, 0, "no partial batch may be written");
});

test("query returns deterministic order and filters", async () => {
  const sink = new InMemoryAuditSink();
  await sink.record(input({ idempotencyKey: asIdempotencyKey("a"), entityId: "r-1" }));
  await sink.record(input({ idempotencyKey: asIdempotencyKey("b"), entityId: "r-2" }));
  const r1 = sink.query({ entityId: "r-1" });
  assert.equal(r1.length, 1);
  assert.equal(r1[0]!.entityId, "r-1");
});

test("append-only history is insert-only and preserves transitions", () => {
  const hist = new AppendOnlyHistory<string>();
  hist.append({
    entityId: "p-1",
    previous: null,
    next: "active",
    actorType: "human",
    actorId: "reviewer-1",
    correlationId: asCorrelationId("c-1"),
    auditEntryId: "audit-1",
  });
  hist.append({
    entityId: "p-1",
    previous: "active",
    next: "suspended",
    actorType: "human",
    actorId: "reviewer-1",
    correlationId: asCorrelationId("c-2"),
    auditEntryId: "audit-2",
  });
  const rows = hist.forEntity("p-1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.next, "active");
  assert.equal(rows[1]!.previous, "active");
  assert.equal(rows[1]!.next, "suspended");
});
