/**
 * VehicleAssignment.tsx — Step 7. Vehicle assigned, insurance activated, business ready.
 * Answer: "The entrepreneur is now ready to earn."
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { VehicleAssignment as VA } from "../data/domain.ts";
import { JourneyTracker, NextStep, PagePurpose } from "../components/ui.tsx";

const STAGES: VA["stage"][] = ["matching", "available", "assigned", "insured", "ready"];

export function VehicleAssignment() {
  const data = useData();
  const nav = useNavigate();
  const { entrepreneurId } = useParams();
  const eid = entrepreneurId ?? "maria";
  const [v, setV] = useState<VA | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() { setV(await data.getVehicle(eid)); }
  useEffect(() => { void refresh(); }, [eid]);

  async function advance() {
    setBusy(true);
    await data.advanceVehicle(eid);
    await refresh();
    setBusy(false);
  }

  if (!v) return <div className="text-ink-muted">No vehicle pipeline found for this entrepreneur yet.</div>;
  const idx = STAGES.indexOf(v.stage);
  const ready = v.stage === "ready";

  const milestones = [
    { label: "Vehicle matched to business class", done: idx >= 1, detail: v.businessClass },
    { label: "Vehicle assigned", done: idx >= 2, detail: v.vehicle },
    { label: "Insurance activated", done: idx >= 3, detail: "Atlas Commercial Coverage" },
    { label: "Business ready to operate", done: idx >= 4, detail: "All systems go" },
  ];

  return (
    <div className="space-y-6">
      <JourneyTracker current={ready ? "operating" : "vehicle_assigned"} />
      <div>
        <div className="eyebrow">Vehicle Assignment</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">{v.vehicle}</h1>
        <PagePurpose>Your business is now equipped and ready to begin operating.</PagePurpose>
        <p className="text-ink-soft mt-1">{v.businessClass} · coordinated with funding and insurance</p>
      </div>

      <div className="card p-6">
        <ol className="space-y-4">
          {milestones.map((m, i) => (
            <li key={m.label} className="flex items-start gap-3">
              <span className={"h-8 w-8 rounded-full grid place-items-center text-sm font-bold shrink-0 " +
                (m.done ? "bg-signal text-white" : i === idx ? "bg-brand text-white" : "bg-canvas text-ink-muted border border-canvas-line")}>
                {m.done ? "✓" : i + 1}
              </span>
              <div>
                <div className={"font-medium " + (m.done ? "text-ink" : "text-ink-muted")}>{m.label}</div>
                {(m.done || i === idx) && <div className="text-sm text-ink-muted">{m.detail}</div>}
              </div>
            </li>
          ))}
        </ol>

        {!ready && (
          <button className="btn-primary mt-6" onClick={advance} disabled={busy}>
            {busy ? "Processing…" : "Advance assignment"}
          </button>
        )}
      </div>

      {ready && (
        <>
          <div className="card p-6 bg-signal text-white border-0 text-center">
            <div className="eyebrow text-white/70">Status</div>
            <div className="font-display text-3xl font-semibold mt-1">Ready to operate</div>
            <p className="text-white/85 mt-1">Vehicle assigned. Insurance active. The business is ready to earn.</p>
          </div>
          <NextStep
            title="Maria can start earning"
            body="Her vehicle is on the road and fully covered. Take her to the marketplace to accept her first coordinated opportunity."
            cta={<button className="btn-primary" onClick={() => nav(`/marketplace/${eid}`)}>Find first opportunity</button>}
          />
        </>
      )}
    </div>
  );
}
