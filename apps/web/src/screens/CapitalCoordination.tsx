/**
 * CapitalCoordination.tsx — Step 6. Funding coordinated across partners.
 * Answer: "This is coordinated, not chaotic."
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { FundingStatus } from "../data/domain.ts";
import { JourneyTracker, SectionTitle, NextStep, money, PagePurpose } from "../components/ui.tsx";

const STAGES: FundingStatus["stage"][] = ["requested", "submitted", "under_review", "approved", "complete"];
const STAGE_LABEL: Record<string, string> = {
  requested: "Requested", submitted: "Documentation submitted", under_review: "Partner review", approved: "Approved", complete: "Funding complete",
};

export function CapitalCoordination() {
  const data = useData();
  const nav = useNavigate();
  const { entrepreneurId } = useParams();
  const eid = entrepreneurId ?? "maria";
  const [funding, setFunding] = useState<FundingStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() { setFunding(await data.getFunding(eid)); }
  useEffect(() => { void refresh(); }, [eid]);

  async function advance() {
    setBusy(true);
    await data.advanceFunding(eid);
    await refresh();
    setBusy(false);
  }

  if (!funding) return <div className="text-ink-muted">No funding request found for this entrepreneur yet.</div>;
  const idx = STAGES.indexOf(funding.stage);
  const isComplete = funding.stage === "complete" || funding.stage === "approved";

  const docs = [
    { label: "Identity & referral verification", done: idx >= 1 },
    { label: "Generated business plan", done: idx >= 1 },
    { label: "Insurance pre-qualification", done: idx >= 2 },
    { label: "Lender underwriting", done: idx >= 3 },
  ];

  return (
    <div className="space-y-6">
      <JourneyTracker current="business_created" />
      <div>
        <div className="eyebrow">Capital Coordination</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">Funding {money(funding.amount)}</h1>
        <PagePurpose>Track every step required to prepare your business for operation.</PagePurpose>
        <p className="text-ink-soft mt-1 max-w-2xl">
          DSUSA coordinates funding across the lender, insurance, and compliance partners — so the entrepreneur
          gets a single, clear path instead of chasing each one separately.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Funding progress */}
        <div className="lg:col-span-2 card p-6">
          <SectionTitle>Funding progress</SectionTitle>
          <ol className="space-y-3">
            {STAGES.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className={"h-7 w-7 rounded-full grid place-items-center text-xs font-bold " +
                  (i <= idx ? "bg-brand text-white" : "bg-canvas text-ink-muted border border-canvas-line")}>
                  {i < idx ? "✓" : i + 1}
                </span>
                <span className={"text-sm " + (i <= idx ? "text-ink font-medium" : "text-ink-muted")}>{STAGE_LABEL[s]}</span>
                {i === idx && <span className="pill bg-brand-tint text-brand ml-auto">Current</span>}
              </li>
            ))}
          </ol>
          {funding.stage !== "complete" && (
            <button className="btn-primary mt-5" onClick={advance} disabled={busy}>
              {busy ? "Advancing…" : "Advance funding"}
            </button>
          )}
        </div>

        {/* Documentation + partners */}
        <div className="space-y-6">
          <div className="card p-5">
            <SectionTitle>Documentation</SectionTitle>
            <ul className="space-y-2">
              {docs.map((doc) => (
                <li key={doc.label} className="flex items-center gap-2 text-sm">
                  <span className={"h-4 w-4 rounded-full grid place-items-center text-[10px] " + (doc.done ? "bg-signal text-white" : "bg-canvas border border-canvas-line")}>{doc.done ? "✓" : ""}</span>
                  <span className={doc.done ? "text-ink" : "text-ink-muted"}>{doc.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <SectionTitle>Partner status</SectionTitle>
            <ul className="space-y-2 text-sm">
              <PartnerRow name={funding.lender} role="Lender" status={idx >= 3 ? "Approved" : "Reviewing"} ok={idx >= 3} />
              <PartnerRow name="Atlas Commercial Coverage" role="Insurance" status={idx >= 2 ? "Pre-qualified" : "Pending"} ok={idx >= 2} />
              <PartnerRow name="DOT Compliance Co." role="Compliance" status={idx >= 1 ? "Cleared" : "Pending"} ok={idx >= 1} />
            </ul>
          </div>
        </div>
      </div>

      {/* Approved capital summary */}
      {isComplete && (
        <div className="card p-6 grid sm:grid-cols-3 gap-4">
          <div>
            <div className="eyebrow">Approved capital</div>
            <div className="stat mt-1">{money(funding.amount)}</div>
          </div>
          <div>
            <div className="eyebrow">Lender</div>
            <div className="text-lg font-semibold text-ink mt-1">{funding.lender}</div>
          </div>
          <div>
            <div className="eyebrow">Status</div>
            <div className="pill bg-signal-tint text-signal mt-2">Ready for vehicle assignment</div>
          </div>
        </div>
      )}

      {isComplete && (
        <NextStep
          title="Capital is in place — assign the vehicle"
          body="With funding approved and partners coordinated, the entrepreneur is ready to receive their vehicle and activate insurance."
          cta={<button className="btn-primary" onClick={() => nav(`/vehicle/${eid}`)}>Continue to vehicle assignment</button>}
        />
      )}
    </div>
  );
}

function PartnerRow({ name, role, status, ok }: { name: string; role: string; status: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <div>
        <div className="text-ink font-medium">{name}</div>
        <div className="text-xs text-ink-muted">{role}</div>
      </div>
      <span className={"pill " + (ok ? "bg-signal-tint text-signal" : "bg-canvas text-ink-muted border border-canvas-line")}>{status}</span>
    </li>
  );
}
