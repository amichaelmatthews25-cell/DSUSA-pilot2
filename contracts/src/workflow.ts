/**
 * contracts/workflow — canonical Workflow Service interface (PMS-5). ORCHESTRATION-CRITICAL.
 *
 * Orchestrates execution; never owns business decisions. Therefore:
 *  - A WorkflowDefinition is EXTERNAL DATA supplied by callers (a declared step graph), never embedded
 *    in engine code. The engine ships zero workflows.
 *  - ALL business work is delegated through declared steps to injected StepHandlers. The engine itself
 *    executes no business logic, evaluates no rules/authorization, calls no AI, mutates no business tables.
 *  - Execution is deterministic + resumable + idempotent: a step is run at most once per execution
 *    (idempotent resume); the same definition + inputs + step outcomes => the same execution path.
 *  - Every execution is fully recorded for replay + explainability; pause/resume, retry, and
 *    compensation (rollback hooks) are first-class.
 *
 * Breaking changes require constitutional review.
 */
import type { CorrelationId } from "../../libs/types/src/index.ts";

/** A declared workflow step. `action` names a StepHandler the caller registers; the engine never
 *  interprets what the action DOES — it only sequences and delegates. */
export interface WorkflowStep {
  readonly id: string;
  /** Handler key the engine delegates to (business work lives in the handler, not the engine). */
  readonly action: string;
  /** Step ids that must be completed before this step may run (DAG edges). */
  readonly dependsOn?: readonly string[];
  /** Optional compensation handler key, invoked on rollback for already-completed steps. */
  readonly compensate?: string;
  /** Max attempts for this step before the execution fails (retry). Default 1. */
  readonly maxAttempts?: number;
}

/** A versioned, immutable workflow definition (a step DAG). Identity = (workflowId, version). */
export interface WorkflowDefinition {
  readonly workflowId: string;
  readonly version: number;
  readonly steps: readonly WorkflowStep[];
}

export type ExecutionState =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated";

/** Result a StepHandler returns. The engine treats `output` as opaque (no business interpretation). */
export interface StepResult {
  readonly status: "ok" | "retry" | "fail";
  readonly output?: Readonly<Record<string, unknown>>;
  readonly explanation?: string;
}

/** Context handed to a StepHandler. Inputs + prior step outputs are available; no engine internals. */
export interface StepContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly version: number;
  readonly stepId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly priorOutputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly correlationId: CorrelationId;
  /** Dry-run: handlers must perform no side effects when true. */
  readonly dryRun: boolean;
}

/** A delegated unit of business work. Lives OUTSIDE the engine (registered by callers/agents). */
export type StepHandler = (ctx: StepContext) => Promise<StepResult>;
/** A compensation handler (rollback). */
export type CompensationHandler = (ctx: StepContext) => Promise<void>;

export interface StartRequest {
  readonly workflowId: string;
  readonly version: number;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
  /** Idempotency key so a duplicated start does not create two executions. */
  readonly idempotencyKey: string;
  readonly dryRun?: boolean;
}

/** A recorded step transition. */
export interface StepRecord {
  readonly stepId: string;
  readonly action: string;
  readonly status: "completed" | "failed" | "compensated";
  readonly attempts: number;
  readonly output: Readonly<Record<string, unknown>>;
  readonly at: string;
}

/** The complete, reproducible execution record. */
export interface WorkflowExecution {
  readonly executionId: string;
  readonly workflowId: string;
  readonly version: number;
  readonly state: ExecutionState;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly completedSteps: readonly StepRecord[];
  readonly pendingSteps: readonly string[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly correlationId: CorrelationId;
  readonly auditRef: string;
  readonly explanation: string;
  readonly dryRun: boolean;
}

export interface WorkflowService {
  /** Register an immutable workflow definition version (external data). Re-registering a version is rejected. */
  registerWorkflow(def: WorkflowDefinition): void;
  /** Register the handler that performs an action's business work (delegation boundary). */
  registerStepHandler(action: string, handler: StepHandler): void;
  /** Register a compensation handler. */
  registerCompensation(action: string, handler: CompensationHandler): void;
  /** Start (or idempotently return) an execution and run until completion/pause/failure. */
  start(req: StartRequest): Promise<WorkflowExecution>;
  /** Resume a paused execution. Idempotent: completed steps are never re-run. */
  resume(executionId: string): Promise<WorkflowExecution>;
  /** Pause a running execution at the next safe boundary. */
  pause(executionId: string): Promise<WorkflowExecution>;
  /** Deterministic replay from the recorded execution (no side effects). */
  replay(executionId: string): Promise<{ original: WorkflowExecution; replayedPath: readonly string[]; matches: boolean }>;
  /** Registered versions of a workflow (coexistence/migration testing). */
  versionsOf(workflowId: string): readonly number[];
  /** Fetch a recorded execution. */
  getExecution(executionId: string): Promise<WorkflowExecution | null>;
}
