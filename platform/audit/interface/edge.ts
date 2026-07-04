/**
 * platform/audit/interface — edge-function host for the Audit Service.
 *
 * Per Implementation Program §10: each edge function (a) authenticates, (b) [for privileged ops]
 * the component gates via roles, (c) executes the component interface, (d) emits audit.
 *
 * Audit is foundational: writes are authenticated as service identities; reads are role-gated and
 * self-audited. There is NO call to the Authorization Service here (cycle-break, PMS-1 §9).
 *
 * This host is transport-agnostic: `handle` takes a parsed request and returns a result. A thin
 * HTTP/edge adapter (deployment) maps the runtime request onto `handle`.
 */
import type { AuditService, AuditQueryFilter } from "../../../contracts/src/audit.ts";
import type { AuditInput, AuditClass } from "../../../libs/audit-kit/src/index.ts";
import type { ActorContext } from "../../../libs/types/src/index.ts";
import { AuditServiceImpl, AuditAccessError } from "../domain/service.ts";

export type AuditRequest =
  | { op: "record"; input: AuditInput; auditClass?: AuditClass }
  | { op: "recordBatch"; inputs: readonly AuditInput[] }
  | { op: "query"; filter: AuditQueryFilter; reader: ActorContext }
  | { op: "get"; id: string };

export type AuditResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: "denied" | "bad_request" | "error" };

export class AuditEdge {
  private readonly svc: AuditServiceImpl & AuditService;

  constructor(svc: AuditServiceImpl & AuditService) {
    this.svc = svc;
  }

  async handle(req: AuditRequest): Promise<AuditResponse> {
    try {
      switch (req.op) {
        case "record":
          return { ok: true, data: await this.svc.record(req.input, req.auditClass) };
        case "recordBatch":
          return { ok: true, data: await this.svc.recordBatch(req.inputs) };
        case "query":
          return { ok: true, data: await this.svc.queryAudit(req.filter, req.reader) };
        case "get": {
          const entry = await this.svc.getAuditEntry(req.id);
          return { ok: true, data: entry };
        }
        default: {
          const _exhaustive: never = req;
          return { ok: false, error: "unknown op", code: "bad_request" };
        }
      }
    } catch (err) {
      if (err instanceof AuditAccessError) {
        return { ok: false, error: err.message, code: "denied" };
      }
      if (err instanceof Error && /malformed/.test(err.message)) {
        return { ok: false, error: err.message, code: "bad_request" };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "error" };
    }
  }
}
