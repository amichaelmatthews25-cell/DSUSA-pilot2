# Workflow Service (PMS-5) — ORCHESTRATION-CRITICAL

Orchestrates execution; never owns business decisions. Workflow definitions are **external data**
(step DAGs); all business work is **delegated to registered step handlers** outside the engine.

## Invariants (enforced in code + verified)
- Orchestrates execution only; owns no policy, rules, authorization, AI, or business entities.
- Executes externally supplied workflow definitions; deterministic, resumable, idempotent execution; full auditability.
- Every execution records workflowId, version, executionId, state, timestamps, completed/pending steps,
  correlationId, auditRef.
- pause/resume (idempotent — completed steps never re-run, duplicate resume de-duped), retry (per-step
  maxAttempts), compensation (reverse-order rollback hooks), deterministic replay, dry-run, version coexistence.
- Never executes business logic, evaluates authorization/rules, calls AI, or mutates business tables —
  all such work is delegated through declared steps.

## Package layout
- `interface/edge.ts` — edge host; registration gated (governance/platform admin); start/resume/pause/replay callable.
- `domain/validator.ts` — DAG validation (acyclic, deps resolve) + deterministic topo order. No business vocabulary.
- `domain/engine.ts` — deterministic driver, delegation, pause/resume (in-flight de-dup), retry, compensation, replay, dry-run.
- `data/store.ts` — immutable `WorkflowRegistry` + resumable `ExecutionStore` ports + in-memory adapters (TEST ONLY).
- `data/pg-store.ts` — **production** Postgres adapters (migration 0005).
- `test/` — replay, pause/resume, retry, compensation, concurrency, duplicate handling, idempotent resume,
  version coexistence, dry-run, explanation consistency, regression.

## Run
```
npm run test:workflow      # 17 tests
npm run verify:workflow    # verification + Workflow Correctness Review (16 checks)
npm run verify:consistency # Cross-Service Consistency Review PMS-1..PMS-5 (23 checks)
```

## Deployment readiness
Implementation-complete. Schema via migration 0005 (+ rollback). Production-validated pending readiness
gate. The in-flight resume guard maps to a DB row lock / optimistic state CAS in production.
