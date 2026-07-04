# Authorization Service (PMS-3) — SAFETY-CRITICAL

Composes authoritative facts into synchronous, fail-closed, fully-reproducible authorization decisions.
**Composition, never origination.** Stores no authority; caches no enforcement.

## Constitutional invariants (enforced in code + verified)
- **Composition, not origination** — reads facts live from single-owner `FactProvider`s; no standing/
  eligibility/cache tables (migration 0003 creates only an append-only decision *log*).
- **Fail closed** — unconfigured capability, missing provider, provider unavailable, timeout, stale fact,
  or composition error all return `allowed=false`.
- **No enforcement cache** — every `isAuthorized` reads providers live; the decision log is never read to
  decide; there is no subject-keyed "latest decision" read.
- **Synchronous + deterministic** — same facts + capability version ⇒ same allow/explanation.
- **Single producer per fact** — `registerFactProvider` rejects a second producer for a fact type.
- **Complete auditability** — every decision is audited (transactional) with the composed-facts snapshot;
  the returned decision carries decisionId, timestamp, correlationId, producingFacts, producingServices,
  rulesVersion, explanation, auditRef, reasons.
- **No business rules inside** — predicate content lives in capability definitions (data); the service
  only composes.
- **No dependency on downstream agents** — providers are injected (dependency inversion).

## Package layout
- `interface/edge.ts` — edge host. `isAuthorized` makes NO nested authorization call (enforcement
  primitive). Capability/provider registration gated `platform_admin`.
- `domain/service.ts` — composition engine, fail-closed paths, timeout, staleness, single-producer
  guard, `reproduceDecision()`.
- `data/decision-log.ts` — append-only decision-LOG port + in-memory adapter (TEST ONLY).
- `data/pg-decision-log.ts` — **production** Postgres adapter (append-only, migration 0003). Reuses the
  shared `SqlClient` infra port (type-only) — not a dependency on the Event domain.
- `test/` — fail-open/closed, stale, timeout, unavailable, replay/reproducibility, concurrency,
  determinism, explanation-consistency, composition, single-producer, edge gating.

## Run
```
npm run test:authz      # 17 safety-critical tests
npm run verify:authz    # verification (Part A) + Authorization Correctness Review (Part B): 14 checks
```

## Deployment readiness
Implementation-complete (production decision-log adapter + in-memory test adapter + edge). Schema via
migration 0003 (+ rollback). Production-validated pending readiness gate (live providers + Postgres +
latency/SLO validation). Latency must never be improved by weakening these guarantees (would require
constitutional escalation).
