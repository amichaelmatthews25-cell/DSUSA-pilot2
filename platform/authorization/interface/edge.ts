/**
 * platform/authorization/interface/edge.ts — edge host for the Authorization Service.
 *
 * isAuthorized is the platform's enforcement entrypoint: it is callable by authenticated components and
 * makes NO nested authorization call (it IS the authorization service — no self-recursion, no cycle).
 *
 * Capability definition and fact-provider registration are admin operations gated via the F0 auth
 * substrate (platform_admin). Registration of providers is wiring, not runtime authority.
 */
import type {
  AuthorizationRequest,
  CapabilityDefinition,
  FactProvider,
} from "../../../contracts/src/authorization.ts";
import type { AuthSubstrate } from "../../../libs/auth-kit/src/index.ts";
import type { ActorContext } from "../../../libs/types/src/index.ts";
import { AuthorizationServiceImpl, DuplicateProducerError } from "../domain/service.ts";

export type AuthzRequest =
  | { op: "isAuthorized"; req: AuthorizationRequest }
  | { op: "defineCapability"; admin: ActorContext; def: CapabilityDefinition }
  | { op: "registerProvider"; admin: ActorContext; provider: FactProvider };

export type AuthzResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: "denied" | "duplicate_producer" | "bad_request" | "error" };

export class AuthorizationEdge {
  private readonly svc: AuthorizationServiceImpl;
  private readonly auth: AuthSubstrate;

  constructor(svc: AuthorizationServiceImpl, auth: AuthSubstrate) {
    this.svc = svc;
    this.auth = auth;
  }

  async handle(req: AuthzRequest): Promise<AuthzResponse> {
    try {
      switch (req.op) {
        case "isAuthorized": {
          // No admin gate and NO nested authorization call — this is the enforcement primitive itself.
          const decision = await this.svc.isAuthorized(req.req);
          return { ok: true, data: decision };
        }
        case "defineCapability": {
          const gate = this.auth.requireRole(req.admin, "platform_admin");
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          this.svc.defineCapability(req.def);
          return { ok: true, data: { defined: req.def.code, version: req.def.version } };
        }
        case "registerProvider": {
          const gate = this.auth.requireRole(req.admin, "platform_admin");
          if (!gate.allowed) return { ok: false, error: gate.reason, code: "denied" };
          this.svc.registerFactProvider(req.provider);
          return { ok: true, data: { registered: req.provider.factType } };
        }
        default: {
          const _exhaustive: never = req;
          return { ok: false, error: "unknown op", code: "bad_request" };
        }
      }
    } catch (err) {
      if (err instanceof DuplicateProducerError) {
        return { ok: false, error: err.message, code: "duplicate_producer" };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "error" };
    }
  }
}
