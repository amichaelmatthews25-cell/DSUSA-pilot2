import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthSubstrate, serviceActor } from "../src/index.ts";
import { asCorrelationId } from "../../types/src/index.ts";

const corr = asCorrelationId("corr-1");

function substrate(): AuthSubstrate {
  const s = new AuthSubstrate();
  s.registerService({
    serviceId: "rules-engine",
    displayName: "Rules Engine",
    roles: new Set(["service"]),
  });
  s.registerHuman({ userId: "reviewer-1", roles: new Set(["reviewer"]) });
  s.registerService({
    serviceId: "ops",
    displayName: "Platform Ops",
    roles: new Set(["platform_admin"]),
  });
  return s;
}

test("known service with role is allowed", () => {
  const s = substrate();
  const d = s.requireRole(serviceActor("rules-engine", corr), "service");
  assert.equal(d.allowed, true);
});

test("unknown principal is denied (fail-closed)", () => {
  const s = substrate();
  const d = s.requireRole(serviceActor("ghost-service", corr), "service");
  assert.equal(d.allowed, false);
  assert.match(d.reason, /unknown principal/);
});

test("missing role is denied", () => {
  const s = substrate();
  const d = s.requireRole(serviceActor("rules-engine", corr), "platform_admin");
  assert.equal(d.allowed, false);
  assert.match(d.reason, /missing role/);
});

test("ai actor type can never hold an auth role (structurally non-authoritative)", () => {
  const s = substrate();
  const d = s.requireRole(
    { actorType: "ai", actorId: "rules-engine", correlationId: corr },
    "service",
  );
  assert.equal(d.allowed, false);
});

test("requireAnyRole allows when one matches, denies otherwise", () => {
  const s = substrate();
  const human = { actorType: "human" as const, actorId: "reviewer-1", correlationId: corr };
  assert.equal(s.requireAnyRole(human, ["reviewer", "platform_admin"]).allowed, true);
  assert.equal(s.requireAnyRole(human, ["governance_admin"]).allowed, false);
});
