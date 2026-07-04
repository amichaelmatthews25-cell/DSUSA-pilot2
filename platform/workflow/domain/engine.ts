/**
 * platform/workflow/domain/engine.ts — Workflow Service (PMS-5). ORCHESTRATION-CRITICAL.
 *
 * A deterministic step-DAG executor that DELEGATES all business work to registered StepHandlers.
 * The engine itself:
 *  - executes NO business logic (only sequencing + delegation),
 *  - evaluates NO rules and NO authorization,
 *  - calls NO AI,
 *  - mutates NO business tables (only its own execution store + Audit).
 *
 * Supports pause/resume (idempotent: completed steps never re-run), retry (per-step maxAttempts),
 * compensation (rollback completed steps on failure), deterministic replay, dry-run, version coexistence.
 */
import type {
  CompensationHandler,
  StartRequest,
  StepContext,
  StepHandler,
  StepRecord,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowService,
} from "../../../contracts/src/workflow.ts";
import type { AuditSink } from "../../../libs/audit-kit/src/index.ts";
import { asIdempotencyKey, newOpaqueId, nowTs } from "../../../libs/types/src/index.ts";
import type { ExecutionStore, WorkflowRegistry } from "../data/store.ts";
import { validateWorkflow, topoOrder, MalformedWorkflowError } from "./validator.ts";

const SOURCE = "workflow-service";

export class WorkflowNotFoundError extends Error {
  override readonly name = "WorkflowNotFoundError";
}
export class MissingHandlerError extends Error {
  override readonly name = "MissingHandlerError";
}

export class WorkflowServiceImpl implements WorkflowService {
  private readonly registry: WorkflowRegistry;
  private readonly store: ExecutionStore;
  private readonly audit: AuditSink;
  private readonly clock: () => string;
  private readonly handlers = new Map<string, StepHandler>();
  private readonly compensations = new Map<string, CompensationHandler>();
  /** Pause requests by executionId (cooperative pause at step boundaries). */
  private readonly pauseRequests = new Set<string>();
  /** Executions currently being driven, to prevent concurrent drive of the same execution
   *  (idempotent resume under duplicate delivery). In production this is a DB row lock /
   *  optimistic state compare-and-set on workflow_execution. Maps executionId -> the in-flight
   *  drive promise so a duplicate caller awaits the winner and returns the SAME final state. */
  private readonly inFlight = new Map<string, Promise<WorkflowExecution>>();

  constructor(registry: WorkflowRegistry, store: ExecutionStore, audit: AuditSink, clock: () => string = nowTs) {
    this.registry = registry;
    this.store = store;
    this.audit = audit;
    this.clock = clock;
  }

  registerWorkflow(def: WorkflowDefinition): void {
    validateWorkflow(def);
    this.registry.put(def);
  }
  registerStepHandler(action: string, handler: StepHandler): void {
    this.handlers.set(action, handler);
  }
  registerCompensation(action: string, handler: CompensationHandler): void {
    this.compensations.set(action, handler);
  }
  versionsOf(workflowId: string): readonly number[] {
    return this.registry.versions(workflowId);
  }
  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    return this.store.getById(executionId);
  }

  async start(req: StartRequest): Promise<WorkflowExecution> {
    const def = this.registry.get(req.workflowId, req.version);
    if (!def) throw new WorkflowNotFoundError(`workflow ${req.workflowId} v${req.version} not registered`);
    // Verify every action has a registered handler BEFORE running (delegation boundary is explicit).
    this.assertHandlers(def);

    const order = topoOrder(def.steps);
    const now = this.clock();
    const fresh: WorkflowExecution = {
      executionId: newOpaqueId(),
      workflowId: def.workflowId,
      version: def.version,
      state: "running",
      inputs: req.inputs,
      completedSteps: [],
      pendingSteps: order,
      startedAt: now,
      updatedAt: now,
      correlationId: req.correlationId,
      auditRef: "",
      explanation: "started",
      dryRun: req.dryRun === true,
    };
    // Idempotent start: a duplicate idempotency key returns the original execution (no second run).
    const execution = await this.store.createIfAbsent(fresh, req.idempotencyKey);
    if (execution.executionId !== fresh.executionId) {
      return execution; // already started under this key
    }
    await this.audit.record({
      actorType: "service", actorId: SOURCE, action: "workflow.started",
      entityType: "workflow", entityId: `${def.workflowId}:v${def.version}`,
      metadata: { executionId: execution.executionId, dryRun: execution.dryRun },
      sourceComponent: SOURCE, correlationId: req.correlationId,
      idempotencyKey: asIdempotencyKey(`wf-start-${execution.executionId}`),
    }, "transactional");

    return this.drive(execution, def);
  }

  async resume(executionId: string): Promise<WorkflowExecution> {
    // If a drive is already in flight for this execution, await it and return the SAME final state
    // (idempotent resume under duplicate delivery). Claimed synchronously before any await.
    const existing = this.inFlight.get(executionId);
    if (existing) return existing;

    const drivePromise = (async (): Promise<WorkflowExecution> => {
      const execution = await this.store.getById(executionId);
      if (!execution) throw new WorkflowNotFoundError(`execution ${executionId} not found`);
      if (execution.state === "completed" || execution.state === "failed" || execution.state === "compensated") {
        return execution; // idempotent: terminal executions are returned as-is
      }
      this.pauseRequests.delete(executionId);
      const def = this.registry.get(execution.workflowId, execution.version);
      if (!def) throw new WorkflowNotFoundError(`workflow ${execution.workflowId} v${execution.version} not registered`);
      const running: WorkflowExecution = { ...execution, state: "running", updatedAt: this.clock() };
      await this.store.save(running);
      return this.driveLocked(running, def);
    })();

    this.inFlight.set(executionId, drivePromise);
    try {
      return await drivePromise;
    } finally {
      this.inFlight.delete(executionId);
    }
  }

  async pause(executionId: string): Promise<WorkflowExecution> {
    this.pauseRequests.add(executionId);
    const execution = await this.store.getById(executionId);
    if (!execution) throw new WorkflowNotFoundError(`execution ${executionId} not found`);
    return execution;
  }

  /** Core driver entrypoint for the start path. A freshly-created execution has a unique id and no
   *  concurrent resume, so it drives directly. Resume uses its own in-flight de-dup (see resume()). */
  private async drive(execution: WorkflowExecution, def: WorkflowDefinition): Promise<WorkflowExecution> {
    return this.driveLocked(execution, def);
  }

  private async driveLocked(execution: WorkflowExecution, def: WorkflowDefinition): Promise<WorkflowExecution> {
    const stepById = new Map(def.steps.map((s) => [s.id, s]));
    const completed = new Map(execution.completedSteps.map((r) => [r.stepId, r]));
    let pending = [...execution.pendingSteps];
    const priorOutputs: Record<string, Record<string, unknown>> = {};
    for (const r of execution.completedSteps) priorOutputs[r.stepId] = { ...r.output };

    let state = execution.state;

    while (pending.length > 0) {
      // Cooperative pause at the boundary (resumable later, idempotently).
      if (this.pauseRequests.has(execution.executionId)) {
        state = "paused";
        break;
      }
      const stepId = pending[0]!;
      const step = stepById.get(stepId)!;
      // Idempotent resume: if somehow already completed, skip without re-running.
      if (completed.has(stepId)) { pending = pending.slice(1); continue; }

      const maxAttempts = step.maxAttempts ?? 1;
      let attempt = 0;
      let result: Awaited<ReturnType<StepHandler>> | null = null;
      const handler = this.handlers.get(step.action)!;
      const ctx: StepContext = {
        executionId: execution.executionId, workflowId: def.workflowId, version: def.version,
        stepId, inputs: execution.inputs, priorOutputs: { ...priorOutputs },
        correlationId: execution.correlationId, dryRun: execution.dryRun,
      };

      while (attempt < maxAttempts) {
        attempt++;
        result = await handler(ctx);
        if (result.status === "ok") break;
        if (result.status === "fail") break;
        // status === "retry": loop until attempts exhausted
      }

      if (!result || result.status !== "ok") {
        // Step failed (or exhausted retries) -> compensate completed steps, mark failed.
        const rec: StepRecord = {
          stepId, action: step.action, status: "failed", attempts: attempt,
          output: result?.output ?? {}, at: this.clock(),
        };
        completed.set(stepId, rec);
        const failedExec = await this.persist(execution, def, completed, [], "compensating",
          `step ${stepId} failed after ${attempt} attempt(s)`);
        const compensated = await this.compensate(failedExec, def, completed);
        return compensated;
      }

      const rec: StepRecord = {
        stepId, action: step.action, status: "completed", attempts: attempt,
        output: result.output ?? {}, at: this.clock(),
      };
      completed.set(stepId, rec);
      priorOutputs[stepId] = { ...(result.output ?? {}) };
      pending = pending.slice(1);

      // Persist after each step so the execution is resumable from durable state.
      await this.persist(execution, def, completed, pending, "running", `completed ${stepId}`);
    }

    if (state === "paused") {
      return this.persist(execution, def, completed, pending, "paused", "paused at boundary");
    }
    return this.persist(execution, def, completed, pending, "completed", "all steps completed");
  }

  /** Compensation: invoke rollback hooks for completed steps in reverse order. */
  private async compensate(
    execution: WorkflowExecution, def: WorkflowDefinition, completed: Map<string, StepRecord>,
  ): Promise<WorkflowExecution> {
    const stepById = new Map(def.steps.map((s) => [s.id, s]));
    const completedOk = [...completed.values()].filter((r) => r.status === "completed").reverse();
    for (const rec of completedOk) {
      const step = stepById.get(rec.stepId)!;
      if (step.compensate) {
        const comp = this.compensations.get(step.compensate);
        if (comp) {
          await comp({
            executionId: execution.executionId, workflowId: def.workflowId, version: def.version,
            stepId: rec.stepId, inputs: execution.inputs, priorOutputs: {},
            correlationId: execution.correlationId, dryRun: execution.dryRun,
          });
          completed.set(rec.stepId, { ...rec, status: "compensated" });
        }
      }
    }
    await this.audit.record({
      actorType: "service", actorId: SOURCE, action: "workflow.compensated",
      entityType: "workflow", entityId: `${def.workflowId}:v${def.version}`,
      metadata: { executionId: execution.executionId },
      sourceComponent: SOURCE, correlationId: execution.correlationId,
      idempotencyKey: asIdempotencyKey(`wf-comp-${execution.executionId}`),
    }, "informational");
    return this.persist(execution, def, completed, [], "compensated", "compensated after failure");
  }

  private async persist(
    execution: WorkflowExecution, def: WorkflowDefinition, completed: Map<string, StepRecord>,
    pending: string[], state: WorkflowExecution["state"], explanation: string,
  ): Promise<WorkflowExecution> {
    const updated: WorkflowExecution = {
      ...execution,
      state,
      completedSteps: [...completed.values()],
      pendingSteps: pending,
      updatedAt: this.clock(),
      explanation,
    };
    // Dry-run still records execution state transitions so the path is inspectable, but handlers were
    // told dryRun=true and must have performed no business side effects.
    await this.store.save(updated);
    return updated;
  }

  async replay(executionId: string): Promise<{ original: WorkflowExecution; replayedPath: readonly string[]; matches: boolean }> {
    const original = await this.store.getById(executionId);
    if (!original) throw new WorkflowNotFoundError(`execution ${executionId} not found`);
    const def = this.registry.get(original.workflowId, original.version);
    if (!def) throw new WorkflowNotFoundError(`workflow ${original.workflowId} v${original.version} not registered`);
    // Deterministic path is a pure function of the definition — recompute and compare to recorded order.
    const replayedPath = topoOrder(def.steps);
    const originalPath = original.completedSteps.map((r) => r.stepId);
    // The recorded completed order must be a prefix of the deterministic topo order (same sequencing).
    const matches = originalPath.every((id, i) => replayedPath[i] === id);
    return { original, replayedPath, matches };
  }

  private assertHandlers(def: WorkflowDefinition): void {
    for (const s of def.steps) {
      if (!this.handlers.has(s.action)) {
        throw new MissingHandlerError(`no handler registered for action '${s.action}' (step ${s.id})`);
      }
    }
  }
}

export { MalformedWorkflowError };
