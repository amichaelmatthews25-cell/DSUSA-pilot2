/**
 * platform/workflow/data — persistence for the Workflow Service.
 *
 * Two engine-owned ports:
 *  - WorkflowRegistry: immutable (workflowId, version) definitions (external data; re-register rejected).
 *  - ExecutionStore: execution records + their step history. Resumable: state is durable so an execution
 *    can be paused and resumed (idempotently) without re-running completed steps.
 *
 * No business tables. The engine touches only these stores + the Audit sink.
 */
import type {
  WorkflowDefinition,
  WorkflowExecution,
} from "../../../contracts/src/workflow.ts";

export class ImmutableWorkflowError extends Error {
  override readonly name = "ImmutableWorkflowError";
}

export interface WorkflowRegistry {
  put(def: WorkflowDefinition): void;
  get(workflowId: string, version: number): WorkflowDefinition | null;
  versions(workflowId: string): readonly number[];
}

export interface ExecutionStore {
  /** Create an execution if its idempotency key is new; else return the existing one. */
  createIfAbsent(execution: WorkflowExecution, idempotencyKey: string): Promise<WorkflowExecution>;
  /** Persist the latest execution state (resume-safe snapshot). */
  save(execution: WorkflowExecution): Promise<void>;
  getById(executionId: string): Promise<WorkflowExecution | null>;
  count(): Promise<number>;
}

export class InMemoryWorkflowRegistry implements WorkflowRegistry {
  private readonly map = new Map<string, WorkflowDefinition>();
  private key(id: string, v: number): string { return `${id}\u0000${v}`; }
  put(def: WorkflowDefinition): void {
    const k = this.key(def.workflowId, def.version);
    if (this.map.has(k)) {
      throw new ImmutableWorkflowError(`workflow ${def.workflowId} v${def.version} already exists; versions are immutable`);
    }
    this.map.set(k, deepFreeze(cloneSafe(def)));
  }
  get(workflowId: string, version: number): WorkflowDefinition | null {
    return this.map.get(this.key(workflowId, version)) ?? null;
  }
  versions(workflowId: string): readonly number[] {
    const out: number[] = [];
    for (const k of this.map.keys()) {
      const [id, v] = k.split("\u0000");
      if (id === workflowId) out.push(Number(v));
    }
    return out.sort((a, b) => a - b);
  }
}

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly byId = new Map<string, WorkflowExecution>();
  private readonly idem = new Map<string, string>(); // idemKey -> executionId

  async createIfAbsent(execution: WorkflowExecution, idempotencyKey: string): Promise<WorkflowExecution> {
    const existingId = this.idem.get(idempotencyKey);
    if (existingId) return this.byId.get(existingId)!;
    this.byId.set(execution.executionId, execution);
    this.idem.set(idempotencyKey, execution.executionId);
    return execution;
  }
  async save(execution: WorkflowExecution): Promise<void> {
    this.byId.set(execution.executionId, execution);
  }
  async getById(executionId: string): Promise<WorkflowExecution | null> {
    return this.byId.get(executionId) ?? null;
  }
  async count(): Promise<number> {
    return this.byId.size;
  }
}

function cloneSafe<T>(v: T): T {
  const sc = (globalThis as { structuredClone?: <U>(x: U) => U }).structuredClone;
  return typeof sc === "function" ? sc(v) : (JSON.parse(JSON.stringify(v)) as T);
}
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}
