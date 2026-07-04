/**
 * platform/workflow/domain/validator.ts — workflow definition validation.
 *
 * Validates the step DAG: unique step ids, dependency references resolve, no cycles, attempts >= 1.
 * Contains NO business vocabulary — it validates structure only. Business meaning lives in the
 * caller-supplied definition + the registered step handlers, never here.
 */
import type { WorkflowDefinition, WorkflowStep } from "../../../contracts/src/workflow.ts";

export class MalformedWorkflowError extends Error {
  override readonly name = "MalformedWorkflowError";
}

export function validateWorkflow(def: WorkflowDefinition): void {
  if (!def.workflowId || typeof def.version !== "number" || def.version < 1) {
    throw new MalformedWorkflowError("workflow requires workflowId and version >= 1");
  }
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    throw new MalformedWorkflowError("workflow requires a non-empty steps array");
  }
  const ids = new Set<string>();
  for (const s of def.steps) {
    if (!s.id) throw new MalformedWorkflowError("step requires an id");
    if (ids.has(s.id)) throw new MalformedWorkflowError(`duplicate step id: ${s.id}`);
    ids.add(s.id);
    if (!s.action) throw new MalformedWorkflowError(`step ${s.id} requires an action`);
    if (s.maxAttempts !== undefined && (typeof s.maxAttempts !== "number" || s.maxAttempts < 1)) {
      throw new MalformedWorkflowError(`step ${s.id} maxAttempts must be >= 1`);
    }
  }
  // dependency references resolve
  for (const s of def.steps) {
    for (const dep of s.dependsOn ?? []) {
      if (!ids.has(dep)) throw new MalformedWorkflowError(`step ${s.id} depends on unknown step ${dep}`);
    }
  }
  // acyclic
  assertAcyclic(def.steps);
}

function assertAcyclic(steps: readonly WorkflowStep[]): void {
  const graph = new Map<string, readonly string[]>();
  for (const s of steps) graph.set(s.id, s.dependsOn ?? []);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);
  const visit = (id: string): void => {
    color.set(id, GRAY);
    for (const dep of graph.get(id) ?? []) {
      const c = color.get(dep);
      if (c === GRAY) throw new MalformedWorkflowError(`workflow has a dependency cycle at ${id} -> ${dep}`);
      if (c === WHITE) visit(dep);
    }
    color.set(id, BLACK);
  };
  for (const id of graph.keys()) if (color.get(id) === WHITE) visit(id);
}

/**
 * Deterministic topological order: dependencies first, ties broken by definition order.
 * This is the canonical execution order used for both run and replay (determinism).
 */
export function topoOrder(steps: readonly WorkflowStep[]): readonly string[] {
  const indexById = new Map<string, number>();
  steps.forEach((s, i) => indexById.set(s.id, i));
  const deps = new Map<string, Set<string>>();
  for (const s of steps) deps.set(s.id, new Set(s.dependsOn ?? []));

  const done = new Set<string>();
  const order: string[] = [];
  // Repeatedly pick the lowest-definition-index step whose deps are all done (stable + deterministic).
  while (order.length < steps.length) {
    let picked: string | null = null;
    for (const s of steps) {
      if (done.has(s.id)) continue;
      const ready = [...(deps.get(s.id) ?? [])].every((d) => done.has(d));
      if (ready) { picked = s.id; break; }
    }
    if (picked === null) throw new MalformedWorkflowError("unable to order steps (cycle?)");
    order.push(picked);
    done.add(picked);
  }
  return order;
}
