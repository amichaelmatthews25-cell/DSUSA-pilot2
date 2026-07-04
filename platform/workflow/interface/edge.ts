/**
 * platform/workflow/interface/edge.ts — edge host for the Workflow Service.
 *
 * Workflow registration is gated (governance_admin / platform_admin) — loading external workflow data
 * is administrative. start/resume/pause/replay are callable by authenticated services. The engine makes
 * NO Authorization Service call (orchestration delegates authorization to a declared STEP, if a
 * workflow needs it — it is never evaluated by the engine itself).
 */
import type {
  StartRequest,
  WorkflowDefinition,
} from "../../../contracts/src/workflow.ts";
import type { AuthSubstrate, Role } from "../../../libs/auth-kit/src/index.ts";
import type { ActorContext } from "../../../libs/types/src/index.ts";
import { WorkflowServiceImpl, WorkflowNotFoundError, MissingHandlerError } from "../domain/engine.ts";
import { MalformedWorkflowError } from "../domain/validator.ts";
import { ImmutableWorkflowError } from "../data/store.ts";

export type WorkflowRequest =
  | { op: "registerWorkflow"; admin: ActorContext; def: WorkflowDefinition }
  | { op: "start"; caller: ActorContext; req: StartRequest }
  | { op: "resume"; caller: ActorContext; executionId: string }
  | { op: "pause"; caller: ActorContext; executionId: string }
  | { op: "replay"; caller: ActorContext; executionId: string }
  | { op: "versionsOf"; workflowId: string };

export type WorkflowResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: "denied" | "malformed" | "immutable" | "not_found" | "missing_handler" | "error" };

const REGISTER_ROLES: readonly Role[] = ["governance_admin", "platform_admin"];
const RUN_ROLES: readonly Role[] = ["service", "agent_admin", "platform_admin"];

export class WorkflowEdge {
  private readonly engine: WorkflowServiceImpl;
  private readonly auth: AuthSubstrate;

  constructor(engine: WorkflowServiceImpl, auth: AuthSubstrate) {
    this.engine = engine;
    this.auth = auth;
  }

  async handle(req: WorkflowRequest): Promise<WorkflowResponse> {
    try {
      switch (req.op) {
        case "registerWorkflow": {
          const gate = this.auth.requireAnyRole(req.admin, REGISTER_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          this.engine.registerWorkflow(req.def);
          return { ok: true, data: { registered: `${req.def.workflowId}:v${req.def.version}` } };
        }
        case "start": {
          const gate = this.auth.requireAnyRole(req.caller, RUN_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.engine.start(req.req) };
        }
        case "resume": {
          const gate = this.auth.requireAnyRole(req.caller, RUN_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.engine.resume(req.executionId) };
        }
        case "pause": {
          const gate = this.auth.requireAnyRole(req.caller, RUN_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.engine.pause(req.executionId) };
        }
        case "replay": {
          const gate = this.auth.requireAnyRole(req.caller, ["service", "platform_admin", "audit_reader"]);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.engine.replay(req.executionId) };
        }
        case "versionsOf":
          return { ok: true, data: this.engine.versionsOf(req.workflowId) };
        default: {
          const _exhaustive: never = req;
          return { ok: false, error: "unknown op", code: "error" };
        }
      }
    } catch (err) {
      if (err instanceof MalformedWorkflowError) return { ok: false, error: err.message, code: "malformed" };
      if (err instanceof ImmutableWorkflowError) return { ok: false, error: err.message, code: "immutable" };
      if (err instanceof MissingHandlerError) return { ok: false, error: err.message, code: "missing_handler" };
      if (err instanceof WorkflowNotFoundError) return { ok: false, error: err.message, code: "not_found" };
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "error" };
    }
  }
}
