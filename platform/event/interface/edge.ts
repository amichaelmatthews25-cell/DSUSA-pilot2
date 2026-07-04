/**
 * platform/event/interface/edge.ts — edge-function host for the Event Platform.
 *
 * Stateless entrypoint (Implementation Program §10): authenticate (service identity) -> execute ->
 * respond. Producer/subscribe/replay are service-identity gated at the edge (no Authorization Service
 * call — cycle-break, PMS-2 §9). The delivery worker invokes deliverPending out-of-band (background
 * worker, Implementation Program §11), not through this request edge.
 */
import type {
  EmitRequest,
  OutcomeDeclaration,
  ReplayFilter,
} from "../../../contracts/src/event.ts";
import type { AuthSubstrate, Role } from "../../../libs/auth-kit/src/index.ts";
import type { ActorContext } from "../../../libs/types/src/index.ts";
import { EventPlatformImpl, UnmappedOutcomeError } from "../domain/platform.ts";

export type EventRequest =
  | { op: "declareOutcome"; caller: ActorContext; decl: OutcomeDeclaration }
  | { op: "emitEvent"; caller: ActorContext; req: EmitRequest }
  | { op: "replay"; caller: ActorContext; filter: ReplayFilter };

export type EventResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: "denied" | "unmapped" | "bad_request" | "error" };

const PRODUCE_ROLES: readonly Role[] = ["service", "agent_admin", "platform_admin"];
const REPLAY_ROLES: readonly Role[] = ["platform_admin"];

export class EventEdge {
  private readonly platform: EventPlatformImpl;
  private readonly auth: AuthSubstrate;

  constructor(platform: EventPlatformImpl, auth: AuthSubstrate) {
    this.platform = platform;
    this.auth = auth;
  }

  async handle(req: EventRequest): Promise<EventResponse> {
    try {
      switch (req.op) {
        case "declareOutcome": {
          const gate = this.auth.requireAnyRole(req.caller, PRODUCE_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.platform.declareOutcome(req.decl) };
        }
        case "emitEvent": {
          const gate = this.auth.requireAnyRole(req.caller, PRODUCE_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.platform.emitEvent(req.req) };
        }
        case "replay": {
          const gate = this.auth.requireAnyRole(req.caller, REPLAY_ROLES);
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          return { ok: true, data: await this.platform.replay(req.filter) };
        }
        default: {
          const _exhaustive: never = req;
          return { ok: false, error: "unknown op", code: "bad_request" };
        }
      }
    } catch (err) {
      if (err instanceof UnmappedOutcomeError) {
        return { ok: false, error: err.message, code: "unmapped" };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "error" };
    }
  }
}
