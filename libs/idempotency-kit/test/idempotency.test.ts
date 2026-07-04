import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryIdempotencyStore,
  idempotent,
  ProcessedSet,
} from "../src/index.ts";
import { asIdempotencyKey } from "../../types/src/index.ts";

test("idempotent op runs once; repeated key returns original, no re-exec", async () => {
  const store = new InMemoryIdempotencyStore<number>();
  const key = asIdempotencyKey("k1");
  let calls = 0;
  const first = await idempotent(store, "scope", key, async () => {
    calls++;
    return 42;
  });
  const second = await idempotent(store, "scope", key, async () => {
    calls++;
    return 99; // must NOT run
  });
  assert.equal(first, 42);
  assert.equal(second, 42);
  assert.equal(calls, 1);
});

test("different scopes do not collide", async () => {
  const store = new InMemoryIdempotencyStore<string>();
  const key = asIdempotencyKey("same");
  const a = await idempotent(store, "audit", key, async () => "A");
  const b = await idempotent(store, "event", key, async () => "B");
  assert.equal(a, "A");
  assert.equal(b, "B");
});

test("concurrent idempotent calls converge on a single result", async () => {
  const store = new InMemoryIdempotencyStore<number>();
  const key = asIdempotencyKey("race");
  let calls = 0;
  const ops = Array.from({ length: 10 }, () =>
    idempotent(store, "scope", key, async () => {
      calls++;
      return calls;
    }),
  );
  const results = await Promise.all(ops);
  const unique = new Set(results);
  assert.equal(unique.size, 1, "all concurrent callers must see the same stored result");
});

test("ProcessedSet turns at-least-once into exactly-once effect", () => {
  const set = new ProcessedSet();
  assert.equal(set.isAlreadyProcessed("consumer", "evt-1"), false);
  assert.equal(set.markProcessed("consumer", "evt-1"), true);
  assert.equal(set.isAlreadyProcessed("consumer", "evt-1"), true);
  assert.equal(set.markProcessed("consumer", "evt-1"), false); // duplicate delivery skipped
});
