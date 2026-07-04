/**
 * platform/workflow/data/pg-store.ts — PRODUCTION Postgres adapters for the Workflow Service.
 *
 * Single production implementations of WorkflowRegistry + ExecutionStore against migration 0005.
 * Definitions immutable (unique (workflow_id, version); UPDATE/DELETE revoked). Executions are
 * snapshot-saved (resume-safe). Reuses the shared SqlClient infra port (type-only).
 */
import type {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStep,
  StepRecord,
  ExecutionState,
} from "../../../contracts/src/workflow.ts";
import type { CorrelationId } from "../../../libs/types/src/index.ts";
import type { SqlClient } from "../../event/data/pg-store.ts";
import { ImmutableWorkflowError, type ExecutionStore, type WorkflowRegistry } from "./store.ts";

interface WfDbRow { workflow_id: string; version: number; steps: WorkflowStep[]; }
interface ExecDbRow {
  execution_id: string; workflow_id: string; version: number; state: ExecutionState;
  inputs: Record<string, unknown>; completed_steps: StepRecord[]; pending_steps: string[];
  started_at: string; updated_at: string; correlation_id: string; audit_ref: string;
  explanation: string; dry_run: boolean;
}

export class PostgresWorkflowRegistry implements WorkflowRegistry {
  private readonly sql: SqlClient;
  private readonly cache = new Map<string, WorkflowDefinition>();
  constructor(sql: SqlClient) { this.sql = sql; }
  private key(id: string, v: number): string { return `${id}\u0000${v}`; }

  put(def: WorkflowDefinition): void {
    const k = this.key(def.workflowId, def.version);
    if (this.cache.has(k)) {
      throw new ImmutableWorkflowError(`workflow ${def.workflowId} v${def.version} already exists`);
    }
    void this.sql.query(
      `INSERT INTO workflow_definition (workflow_id, version, steps)
       VALUES ($1,$2,$3) ON CONFLICT (workflow_id, version) DO NOTHING`,
      [def.workflowId, def.version, JSON.stringify(def.steps)],
    );
    this.cache.set(k, def);
  }
  get(workflowId: string, version: number): WorkflowDefinition | null {
    return this.cache.get(this.key(workflowId, version)) ?? null;
  }
  versions(workflowId: string): readonly number[] {
    const out: number[] = [];
    for (const k of this.cache.keys()) {
      const [id, v] = k.split("\u0000");
      if (id === workflowId) out.push(Number(v));
    }
    return out.sort((a, b) => a - b);
  }
  async load(): Promise<void> {
    const { rows } = await this.sql.query<WfDbRow>(`SELECT * FROM workflow_definition`);
    for (const r of rows) this.cache.set(this.key(r.workflow_id, r.version), { workflowId: r.workflow_id, version: r.version, steps: r.steps });
  }
}

export class PostgresExecutionStore implements ExecutionStore {
  private readonly sql: SqlClient;
  constructor(sql: SqlClient) { this.sql = sql; }

  async createIfAbsent(e: WorkflowExecution, idempotencyKey: string): Promise<WorkflowExecution> {
    await this.sql.query(
      `INSERT INTO workflow_execution
         (execution_id, workflow_id, version, state, inputs, completed_steps, pending_steps,
          started_at, updated_at, correlation_id, audit_ref, explanation, dry_run, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        e.executionId, e.workflowId, e.version, e.state, JSON.stringify(e.inputs),
        JSON.stringify(e.completedSteps), JSON.stringify(e.pendingSteps), e.startedAt, e.updatedAt,
        e.correlationId, e.auditRef, e.explanation, e.dryRun, idempotencyKey,
      ],
    );
    const { rows } = await this.sql.query<ExecDbRow>(
      `SELECT * FROM workflow_execution WHERE idempotency_key=$1`, [idempotencyKey],
    );
    return rows[0] ? this.toExec(rows[0]) : e;
  }

  async save(e: WorkflowExecution): Promise<void> {
    await this.sql.query(
      `UPDATE workflow_execution
         SET state=$2, completed_steps=$3, pending_steps=$4, updated_at=$5, explanation=$6
       WHERE execution_id=$1`,
      [e.executionId, e.state, JSON.stringify(e.completedSteps), JSON.stringify(e.pendingSteps), e.updatedAt, e.explanation],
    );
  }

  async getById(executionId: string): Promise<WorkflowExecution | null> {
    const { rows } = await this.sql.query<ExecDbRow>(
      `SELECT * FROM workflow_execution WHERE execution_id=$1`, [executionId],
    );
    return rows[0] ? this.toExec(rows[0]) : null;
  }

  async count(): Promise<number> {
    const { rows } = await this.sql.query<{ count: string }>(`SELECT count(*)::text AS count FROM workflow_execution`);
    return Number(rows[0]?.count ?? "0");
  }

  private toExec(r: ExecDbRow): WorkflowExecution {
    return {
      executionId: r.execution_id, workflowId: r.workflow_id, version: r.version, state: r.state,
      inputs: r.inputs, completedSteps: r.completed_steps, pendingSteps: r.pending_steps,
      startedAt: r.started_at, updatedAt: r.updated_at, correlationId: r.correlation_id as CorrelationId,
      auditRef: r.audit_ref, explanation: r.explanation, dryRun: r.dry_run,
    };
  }
}
