/**
 * continuity.tsx — shared Business Continuity presentation primitives.
 *
 * Business Continuity is a platform capability surfaced in several places. These components keep the
 * language and styling consistent: support that is *designed to* / *intended to* coordinate responses,
 * subject to legal, contractual, and operational requirements — never guaranteed outcomes.
 */
import type { BusinessContinuityStatus } from "../data/domain.ts";

const HEALTH = {
  healthy: { label: "Healthy", cls: "bg-signal-tint text-signal" },
  watch: { label: "Watch", cls: "bg-warn-tint text-warn" },
  at_risk: { label: "At risk", cls: "bg-warn-tint text-warn" },
} as const;

const OPERATIONAL = {
  operating: "Operating normally",
  monitoring: "Under monitoring",
  intervention: "Intervention in progress",
  transition: "Operator transition",
} as const;

const SUPPORT = { standard: "Standard", elevated: "Elevated", active: "Active support" } as const;
const INTERVENTION = { none: "No intervention required", watch: "Monitoring", in_progress: "Intervention in progress" } as const;

/** The entrepreneur-facing Business Continuity status card. */
export function ContinuityStatusCard({ status }: { status: BusinessContinuityStatus }) {
  const h = HEALTH[status.businessHealth];
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Business Continuity</div>
        <span className={"pill " + h.cls}>{h.label}</span>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <Row k="Business health" v={h.label} />
        <Row k="Operational status" v={OPERATIONAL[status.operationalStatus]} />
        <Row k="Support level" v={SUPPORT[status.supportLevel]} />
        <Row k="Intervention status" v={INTERVENTION[status.interventionStatus]} />
        {status.recoveryPlan && <Row k="Recovery plan" v={status.recoveryPlan} />}
      </dl>
      <p className="text-sm text-ink-soft mt-3 pt-3 border-t border-canvas-line">{status.currentStanding}</p>
      <p className="text-[11px] text-ink-muted mt-2">
        Ongoing operational support designed to help the business remain productive. Subject to legal,
        contractual, and operational requirements.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="text-ink font-medium text-right">{v}</dd>
    </div>
  );
}
