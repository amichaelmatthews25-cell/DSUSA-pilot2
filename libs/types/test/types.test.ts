import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asOperatorId,
  asCorrelationId,
  asTimestamp,
  nowTs,
  newOpaqueId,
  ACTOR_TYPES,
} from "../src/index.ts";

test("branded id constructors reject empty strings", () => {
  assert.throws(() => asOperatorId(""), TypeError);
  assert.throws(() => asCorrelationId(""), TypeError);
});

test("opaque ids are non-empty and unique", () => {
  const a = newOpaqueId();
  const b = newOpaqueId();
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test("asTimestamp validates ISO; nowTs is parseable", () => {
  assert.throws(() => asTimestamp("not-a-date"), TypeError);
  const ts = nowTs();
  assert.ok(!Number.isNaN(Date.parse(ts)));
});

test("actor types are the closed constitutional set incl. ai", () => {
  assert.deepEqual([...ACTOR_TYPES], ["agent", "service", "human", "ai", "system"]);
});
