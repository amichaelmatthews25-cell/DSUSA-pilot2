/**
 * Marketplace.tsx — Step 8. Available opportunities, coordinated by DSUSA.
 *
 * Philosophy: DSUSA is NOT a freight broker. It aggregates and coordinates opportunities offered by
 * ecosystem partners (brokers, shippers). The copy reflects "coordinated opportunities," never
 * "DSUSA brokers freight." Maria browses, filters, accepts, tracks, completes.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { FreightLoad } from "../data/domain.ts";
import { JourneyTracker, SectionTitle, NextStep, money, PagePurpose } from "../components/ui.tsx";

type Filter = "all" | "compatible" | "high_value";
const ACTIVE: FreightLoad["status"][] = ["assigned", "in_transit", "delivered", "payment_pending"];

export function Marketplace() {
  const data = useData();
  const nav = useNavigate();
  const { entrepreneurId } = useParams();
  const eid = entrepreneurId ?? "maria";
  const [loads, setLoads] = useState<readonly FreightLoad[]>([]);
  const [filter, setFilter] = useState<Filter>("compatible");
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() { setLoads(await data.listLoads()); }
  useEffect(() => { void refresh(); }, []);

  const active = loads.find((l) => ACTIVE.includes(l.status));
  const available = loads.filter((l) => l.status === "available").filter((l) =>
    filter === "all" ? true : filter === "compatible" ? l.compatible : l.revenue >= 900,
  );

  async function accept(id: string) {
    setBusy(id);
    await data.acceptLoad(eid, id);
    await refresh();
    setBusy(null);
  }
  async function advance(id: string) {
    setBusy(id);
    const updated = await data.advanceLoad(id);
    await refresh();
    setBusy(null);
    if (updated.status === "completed" || updated.status === "payment_pending") {
      nav(`/waterfall/${eid}/${id}`);
    }
  }

  return (
    <div className="space-y-6">
      <JourneyTracker current="operating" />
      <div>
        <div className="eyebrow">Available Opportunities</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">Freight marketplace</h1>
        <PagePurpose>Browse business opportunities coordinated through the DSUSA ecosystem.</PagePurpose>
        <p className="text-ink-muted max-w-2xl">
          Opportunities coordinated by DSUSA from ecosystem partners. DSUSA aggregates work from brokers and
          shippers so entrepreneurs like Maria can find compatible loads in one place.
        </p>
      </div>

      {/* Active load tracker */}
      {active && (
        <div className="card p-5 border-l-4 border-l-brand">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="eyebrow text-brand">Active opportunity</div>
              <div className="font-semibold text-ink mt-0.5">{active.pickup} → {active.delivery}</div>
              <div className="text-sm text-ink-muted">{active.id} · {money(active.revenue)} · {active.distanceMi} mi · via {active.sourcePartner}</div>
            </div>
            <div className="flex items-center gap-3">
              <LoadStatusTrack status={active.status} />
              <button className="btn-primary" onClick={() => advance(active.id)} disabled={busy === active.id}>
                {nextActionLabel(active.status)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {!active && (
        <div className="flex items-center gap-2">
          {([["compatible", "Compatible with my van"], ["high_value", "Highest value"], ["all", "All opportunities"]] as [Filter, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={"pill " + (filter === k ? "bg-brand text-white" : "bg-canvas-panel border border-canvas-line text-ink-soft")}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Opportunity list */}
      {!active && (
        <div className="space-y-3">
          {available.length === 0 && <div className="card p-6 text-ink-muted">No opportunities match this filter right now. Try “All opportunities.”</div>}
          {available.map((l) => (
            <div key={l.id} className="card p-5">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{l.pickup} → {l.delivery}</span>
                    {l.compatible
                      ? <span className="pill bg-signal-tint text-signal">Compatible</span>
                      : <span className="pill bg-canvas text-ink-muted border border-canvas-line">{l.vehicleType} only</span>}
                  </div>
                  <div className="text-sm text-ink-muted">{l.id} · {l.distanceMi} mi · coordinated via {l.sourcePartner}</div>
                  <div className="text-sm text-ink-soft">
                    Gross {money(l.revenue)} · <span className="text-signal font-medium">Est. net to you {money(l.estimatedNet)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="text-right">
                    <div className="font-display text-2xl font-semibold text-ink">{money(l.revenue)}</div>
                    <div className="text-xs text-ink-muted">{Math.round(l.revenue / l.distanceMi)}/mi</div>
                  </div>
                  <button className="btn-primary" onClick={() => accept(l.id)} disabled={!l.compatible || busy === l.id}>
                    {busy === l.id ? "Accepting…" : "Accept opportunity"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (active.status === "payment_pending" || active.status === "completed") && (
        <NextStep
          title="See how everyone gets paid"
          body="Maria completed the work. Watch one customer payment settle across every partner in the ecosystem — and land in Maria’s account."
          cta={<button className="btn-primary" onClick={() => nav(`/waterfall/${eid}/${active.id}`)}>View payment distribution</button>}
        />
      )}
    </div>
  );
}

function LoadStatusTrack({ status }: { status: FreightLoad["status"] }) {
  const flow: FreightLoad["status"][] = ["assigned", "in_transit", "delivered", "payment_pending", "completed"];
  const labels: Record<string, string> = { assigned: "Assigned", in_transit: "In transit", delivered: "Delivered", payment_pending: "Payment pending", completed: "Completed" };
  const idx = flow.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {flow.map((s, i) => (
        <span key={s} className={"pill " + (i <= idx ? "bg-brand text-white" : "bg-canvas text-ink-muted border border-canvas-line")}>
          {labels[s]}
        </span>
      ))}
    </div>
  );
}

function nextActionLabel(status: FreightLoad["status"]): string {
  switch (status) {
    case "assigned": return "Start transit";
    case "in_transit": return "Mark delivered";
    case "delivered": return "Request payment";
    case "payment_pending": return "View payment";
    default: return "Continue";
  }
}
