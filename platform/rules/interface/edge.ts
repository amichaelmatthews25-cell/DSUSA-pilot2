/**
 * platform/rules/interface/edge.ts — edge host for the Rules Engine.
 *
 * registerRuleSet is gated (governance_admin / platform_admin) — loading external policy data is an
 * administrative act. evaluate/replay are callable by authenticated services. The engine makes NO
 * Authorization Service call anywhere (cycle-break) — gating here is the F0 role substrate only.
 */
import type {
  EvaluationRequest,
  RuleSet,
} from "../../../contracts/src/rules.ts";
import type { AuthSubstrate, Role } from "../../../libs/auth-kit/src/index.ts";
import type { ActorContext } from "../../../libs/types/src/index.ts";
import { RulesEngineImpl } from "../domain/engine.ts";
import { MalformedRuleError } from "../domain/evaluator.ts";
import { ImmutableRuleSetError } from "../data/store.ts";

export type RulesRequest =
  | { op: "registerRuleSet"; admin: ActorContext; ruleSet: RuleSet }
  | { op: "evaluate"; caller: ActorContext; req: EvaluationRequest }
  | { op: "replay"; caller: ActorContext; evaluationId: string }
  | { op: "versionsOf"; ruleSetId: string };

export type RulesResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: "denied" | "malformed" | "immutable" | "not_found" | "error" };

const REGISTER_ROLES: readonly Role[] = ["governance_admin", "platform_admin"];

export class RulesEdge {
  private readonly engine: RulesEngineImpl;
  private readonly auth: AuthSubstrate;

  constructor(engine: RulesEngineImpl, auth: AuthSubstrate) {
    this.engine = engine;
    this.auth = auth;
  }

  async handle(req: RulesRequest): Promise<RulesResponse> {
    try {
      switch (req.op) {
        case "registerRuleSet": {
          const gate = this.auth.requireAnyRole(req.admin, REGISTER_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          this.engine.registerRuleSet(req.ruleSet);
          return { ok: true, data: { registered: `${req.ruleSet.ruleSetId}:v${req.ruleSet.version}` } };
        }
        case "evaluate": {
          const gate = this.auth.requireAnyRole(req.caller, ["service", "agent_admin", "platform_admin", "reviewer"]);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.engine.evaluate(req.req) };
        }
        case "replay": {
          const gate = this.auth.requireAnyRole(req.caller, ["service", "platform_admin", "audit_reader"]);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.engine.replay(req.evaluationId) };
        }
        case "versionsOf":
          return { ok: true, data: this.engine.versionsOf(req.ruleSetId) };
        default: {
          const _exhaustive: never = req;
          return { ok: false, error: "unknown op", code: "error" };
        }
      }
    } catch (err) {
      if (err instanceof MalformedRuleError) return { ok: false, error: err.message, code: "malformed" };
      if (err instanceof ImmutableRuleSetError) return { ok: false, error: err.message, code: "immutable" };
      if (err instanceof Error && /not registered|no recorded/.test(err.message)) {
        return { ok: false, error: err.message, code: "not_found" };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "error" };
    }
  }
}
