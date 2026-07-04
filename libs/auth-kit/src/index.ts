/**
 * @dsusa/auth-kit — F0 authentication substrate.
 *
 * This is NOT the Authorization Service (PMS-3). It is the identity foundation that:
 *  - establishes human RBAC roles and service identities (mutual service auth),
 *  - propagates ActorContext (actor + correlation),
 *  - provides the FAIL-CLOSED default that every consumer relies on.
 *
 * The Authorization Service later COMPOSES domain-owned authority facts over this substrate.
 * auth-kit never stores standing/eligibility and never makes a business authorization decision.
 */

import type { ActorContext, ActorType } from "../../types/src/index.ts";

/** Platform RBAC roles (F0 baseline; capability composition is the Authorization Service's job). */
export const ROLES = [
  "platform_admin",
  "identity_steward",
  "audit_reader",
  "governance_admin",
  "agent_admin",
  "reviewer",
  "service",
] as const;
export type Role = (typeof ROLES)[number];

/** A registered service identity (mutual service auth). Services authenticate as one of these. */
export interface ServiceIdentity {
  readonly serviceId: string;
  readonly displayName: string;
  /** Roles granted to this service identity (e.g., a writer service holds `service`). */
  readonly roles: ReadonlySet<Role>;
}

/** A human principal with RBAC roles (resolved from staff_users in real deployments). */
export interface HumanPrincipal {
  readonly userId: string;
  readonly roles: ReadonlySet<Role>;
}

/** Result of an access check. Fail-closed: anything not explicitly allowed is denied. */
export interface AccessDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

const ALLOW: AccessDecision = { allowed: true, reason: "ok" };
function deny(reason: string): AccessDecision {
  return { allowed: false, reason };
}

/**
 * The auth substrate. In-memory registry for F0; the same interface is implemented over
 * the database/identity provider in deployment. Fail-closed everywhere.
 */
export class AuthSubstrate {
  private readonly services = new Map<string, ServiceIdentity>();
  private readonly humans = new Map<string, HumanPrincipal>();

  registerService(identity: ServiceIdentity): void {
    if (!identity.serviceId) throw new TypeError("serviceId required");
    this.services.set(identity.serviceId, identity);
  }

  registerHuman(principal: HumanPrincipal): void {
    if (!principal.userId) throw new TypeError("userId required");
    this.humans.set(principal.userId, principal);
  }

  /** Authenticate a service identity. Returns null if unknown (caller must fail closed). */
  authenticateService(serviceId: string): ServiceIdentity | null {
    return this.services.get(serviceId) ?? null;
  }

  authenticateHuman(userId: string): HumanPrincipal | null {
    return this.humans.get(userId) ?? null;
  }

  /**
   * F0 role-gate. NOT business authorization — only "does this principal hold this role".
   * Fail-closed: unknown principal or missing role => denied.
   */
  requireRole(ctx: ActorContext, role: Role): AccessDecision {
    const roles = this.rolesFor(ctx);
    if (roles === null) return deny(`unknown principal: ${ctx.actorType}:${ctx.actorId}`);
    if (!roles.has(role)) return deny(`missing role: ${role}`);
    return ALLOW;
  }

  /** Require any one of the listed roles. Fail-closed. */
  requireAnyRole(ctx: ActorContext, roles: readonly Role[]): AccessDecision {
    const held = this.rolesFor(ctx);
    if (held === null) return deny(`unknown principal: ${ctx.actorType}:${ctx.actorId}`);
    for (const r of roles) if (held.has(r)) return ALLOW;
    return deny(`missing any of roles: ${roles.join(", ")}`);
  }

  private rolesFor(ctx: ActorContext): ReadonlySet<Role> | null {
    const t: ActorType = ctx.actorType;
    if (t === "service" || t === "system") {
      return this.services.get(ctx.actorId)?.roles ?? null;
    }
    if (t === "human") {
      return this.humans.get(ctx.actorId)?.roles ?? null;
    }
    // agents authenticate as service identities in this substrate; `ai` never holds auth roles.
    if (t === "agent") {
      return this.services.get(ctx.actorId)?.roles ?? null;
    }
    return null; // `ai` and anything else => fail closed (AI is structurally non-authoritative).
  }
}

/** Helper to build an ActorContext for a service identity. */
export function serviceActor(
  serviceId: string,
  correlationId: ActorContext["correlationId"],
): ActorContext {
  return { actorType: "service", actorId: serviceId, correlationId };
}
