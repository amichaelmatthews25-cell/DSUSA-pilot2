# DSUSA Platform — Stage F0 (Foundation)

This is the implementation foundation from the Implementation Program. It is **executable**: code
compiles/runs, tests pass, migrations are ordered with rollbacks, verification passes.

## What F0 contains
- **Monorepo skeleton** (`/libs`, `/platform`, `/registries`, `/agents`, `/db`, `/ops`, `/contracts`)
  per Implementation Program §2.
- **Shared libraries** (§4):
  - `@dsusa/types` — opaque branded canonical ids, `actor_type` enum (incl. `ai`), correlation/idempotency keys.
  - `@dsusa/auth-kit` — F0 auth substrate: RBAC roles, service identities, **fail-closed** role gating.
  - `@dsusa/idempotency-kit` — idempotency wrapper + consumer de-dup (`ProcessedSet`).
  - `@dsusa/audit-kit` — `AuditSink` (append-only, idempotent) + append-only-history pattern.
- **Auth substrate migration** `0000_auth_substrate.sql` — staff_users, RBAC, service identities, enums.
- **Audit Service schema** `0001_audit_service.sql` — append-only `audit_entry`, idempotency unique index,
  UPDATE/DELETE revoked + trigger guard (PMS-1 §14). *(Audit table lands in F0 because every component
  depends on it and it is the first build node; the Audit Service logic stage builds on this schema.)*
- **CI** (`ops/ci/ci.yml`), **deploy/rollback** (`ops/deploy/*.sh`), **env template**, and
  **verification** (`ops/verify/*.ts`).

## Run it (no external dependencies required — Node 22 native TS stripping)
```bash
npm run test:f0          # unit tests (18)
npm run verify:f0        # assembled-substrate invariant verification (8 checks)
npm run migrate:check    # migration ordering + rollback pairing
```

## Invariants proven at F0
- Auth is **fail-closed** (unknown principal denied; `ai` actor can hold no role — structural non-authority).
- Audit is **append-only** (no update/delete API; DB trigger + revoked grants) and **idempotent**.
- Idempotency holds under **repeat and concurrency** (callers converge on one result).
- Canonical ids are **opaque and unique**.

## Deployment readiness
- **Implementation-complete:** yes (code + tests + migrations + verification).
- **Deployment-complete:** on running `deploy-f0.sh` against a Postgres target.
- **Production-validated:** pending readiness gate (Implementation Program §24) in a prod-like env.

## Notes
- Tests run dependency-free via `node --experimental-strip-types`. `devDependencies` (tsx/typescript)
  document the intended toolchain for environments with network access; they are not required to run F0.
- No architecture changed; no new platform capability or constitutional rule introduced.
