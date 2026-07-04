# Rules Engine (PMS-4) — POLICY-CRITICAL

Executes policy; never defines it. Rule sets are **external data** supplied by callers; the engine is a
deterministic interpreter over a closed, generic expression AST with **zero business vocabulary**.

## Invariants (enforced in code + verified)
- Evaluates rules only; owns no policy, no business entities, no authorization/workflow/AI logic.
- Deterministic, versioned execution; immutable rule history; reproducible evaluations; full explainability.
- Rule definitions are external data, never embedded in engine code.
- Every evaluation records ruleSetId, version, timestamp, inputs, outputs, explanation, correlationId, auditRef.
- Deterministic replay; side-by-side multi-version execution; dry-run (no state mutation); identical
  inputs+version ⇒ identical output.
- **Never calls the Authorization Service**; **never reads/writes business tables**. Inputs are caller-supplied.

## Package layout
- `interface/edge.ts` — edge host; registration gated (governance/platform admin); evaluate/replay callable.
- `domain/evaluator.ts` — pure, total expression interpreter + rule-set validator (no business vocabulary).
- `domain/engine.ts` — evaluate / replay / version coexistence / dry-run; audited; deterministic.
- `data/store.ts` — immutable `RuleSetRegistry` + append-only `EvaluationLog` ports + in-memory adapters (TEST ONLY).
- `data/pg-store.ts` — **production** Postgres adapters (migration 0004): immutable rule sets, append-only evaluations.
- `test/` — determinism, replay, version replay, dry-run, concurrency, malformed rejection, validation,
  version coexistence, repeatability, explanation consistency, no-hidden-state, no-authz-dependency, regression.

## Run
```
npm run test:rules      # 17 tests
npm run verify:rules    # verification (Part A) + Rules Engine Correctness Review (Part B): 10 checks
```

## Deployment readiness
Implementation-complete (production registry+log adapters + in-memory test adapters + edge). Schema via
migration 0004 (+ rollback). Production-validated pending readiness gate (live Postgres + governance
rule-set load). Any latency optimization that changes evaluation semantics requires constitutional escalation.
