# Audit Service (PMS-1)

First Platform Mechanism Service. Append-only, idempotent, foundational (consumes nothing but the F0
auth substrate). Built on the `audit_entry` schema from migration `0001` and `@dsusa/audit-kit`.

## Package layout (Implementation Program §3)
- `interface/edge.ts` — stateless edge-function host (authenticate -> execute -> respond).
- `domain/service.ts` — service logic: record/recordBatch, transactional vs informational classes,
  role-gated + self-audited query (PMS-1 §9/§13). No call to the Authorization Service (cycle-break §9).
- `data/store.ts` — append-only `AuditStore` port + in-memory adapter; Postgres adapter implements the
  same port against migration 0001 (UPDATE/DELETE revoked + trigger guard).
- `test/` — service-level tests.

## Run
```
npm run test:audit      # service tests
npm run verify:audit    # assembled-service invariant verification (7 checks)
```

## Invariants proven
Idempotent writes; audit-class metadata; append-only (no mutate API + DB trigger); batch all-or-nothing;
read fail-closed without `audit_reader`/`platform_admin`; reads are self-audited.

## Deployment readiness
Implementation-complete. Schema ships via migration 0001 (already in F0). Production-validated pending
the readiness gate in a prod-like env (real Postgres adapter + load).
