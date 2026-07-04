# Event Platform (PMS-2)

Durable, replay-safe, at-least-once event bus. Consumes Audit (PMS-1) for delivery logging. No
dependency on Authorization (cycle-break — service-identity gating at the edge).

## Package layout
- `interface/edge.ts` — edge host (produce/replay gated by service identity).
- `domain/platform.ts` — publisher, subscriber, outbox driver, retry, dead-letter, replay, D12 mapping,
  consumer de-dup, structured logging + metrics hooks.
- `data/store.ts` — `EventStore` port + in-memory adapter (TEST ONLY).
- `data/pg-store.ts` — **production** Postgres/Supabase adapter (the single production impl) against
  migration 0002. ON CONFLICT idempotency; FOR UPDATE SKIP LOCKED claim; atomic dead-letter transition.
- `test/` — unit tests + production-adapter integration tests (SQL emulator; swappable for real PG in CI).

## Run
```
npm run test:event      # unit + integration
npm run verify:event    # assembled-platform invariant verification (6 checks)
```

## Invariants proven
State-change-first enqueue (in producer tx); producer idempotency; at-least-once delivery with
exactly-once consumer effect (de-dup); retry then dead-letter on exhaustion; outcome->event mapping
fails closed when unmapped; replay reads frozen payloads and de-dups (no state corruption).

## Deployment readiness
Implementation-complete (production PG adapter + in-memory test adapter + edge + worker entrypoint).
Schema via migration 0002 (+ rollback). Production-validated pending readiness gate (real Postgres +
load + delivery-worker runtime).
