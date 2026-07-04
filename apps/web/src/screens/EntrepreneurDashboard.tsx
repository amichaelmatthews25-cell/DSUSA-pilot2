/**
 * EntrepreneurDashboard.tsx — Step 10. Maria's home base. Must feel alive.
 * Revenue, Vehicle, Business Health, Qualification, Business Services, Next Steps,
 * Recent Activity, Upcoming Tasks, Business KPIs.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { EntrepreneurDashboard as Dash, ServicePartner, FreightLoad, BusinessContinuityStatus } from "../data/domain.ts";
import { JourneyTracker, Stat, SectionTitle, HealthPill, money, PagePurpose } from "../components/ui.tsx";
import { ContinuityStatusCard } from "../components/continuity.tsx";

export function EntrepreneurDashboard() {
  const data = useData();
  const nav = useNavigate();
  const { entrepreneurId } = useParams();
  const [dash, setDash] = useState<Dash | null>(null);
  const [services, setServices] = useState<readonly ServicePartner[]>([]);
  const [loads, setLoads] = useState<readonly FreightLoad[]>([]);
  const [continuity, setContinuity] = useState<BusinessContinuityStatus | null>(null);

  useEffect(() => {
    if (!entrepreneurId) return;
    void Promise.all([data.getDashboard(entrepreneurId), data.listServicePartners(), data.listLoads(), data.getContinuityStatus(entrepreneurId)])
      .then(([d, s, l, c]) => { setDash(d); setServices(s); setLoads(l); setContinuity(c); });
  }, [entrepreneurId]);

  if (!dash) return <div className="text-ink-muted">Loading…</div>;
  const { entrepreneur: e, businessPlan, revenueToDate, completedLoads, businessHealth, funding, vehicle } = dash;
  const connected = services.filter((s) => s.status === "connected");

  return (
    <div className="space-y-6">
      <JourneyTracker current={e.stage} />

      {/* Hero */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">Entrepreneur Dashboard</div>
          <h1 className="font-display text-3xl font-semibold text-ink mt-1">{e.name}</h1>
        <PagePurpose>Manage your business from one coordinated operating platform.</PagePurpose>
          <p className="text-ink-muted">{businessPlan?.profile.legalName ?? "Business profile"} · {e.businessClass?.label}</p>
        </div>
        <div className="flex items-center gap-2">
          <HealthPill health={businessHealth} />
          <span className="pill bg-signal-tint text-signal">Qualified · Approved</span>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Revenue to date" value={money(revenueToDate)} sub="last 90 days" />
        <Stat label="Completed loads" value={completedLoads} sub="delivered & paid" />
        <Stat label="Vehicle" value={vehicle?.vehicle.split(" ").slice(-2).join(" ") ?? "—"} sub={vehicle ? vehicleStageLabel(vehicle.stage) : "pending"} />
        <Stat label="Funding" value={funding ? fundingLabel(funding.stage) : "—"} sub={funding ? money(funding.amount) : ""} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: activity + tasks */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-5">
            <SectionTitle>Recent activity</SectionTitle>
            <ul className="space-y-3">
              {RECENT_ACTIVITY.map((a) => (
                <li key={a.text} className="flex items-start gap-3">
                  <span className="h-2 w-2 rounded-full bg-brand mt-1.5 shrink-0" />
                  <div>
                    <div className="text-sm text-ink">{a.text}</div>
                    <div className="text-xs text-ink-muted">{a.when}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-5">
            <SectionTitle action={<span className="text-xs text-ink-muted">{loads.filter((l) => l.status === "available").length} loads available</span>}>
              Upcoming tasks
            </SectionTitle>
            <ul className="space-y-2">
              {UPCOMING_TASKS.map((t) => (
                <li key={t.label} className="flex items-center justify-between p-3 rounded-lg border border-canvas-line">
                  <span className="text-sm text-ink">{t.label}</span>
                  <span className={"pill " + (t.urgent ? "bg-warn-tint text-warn" : "bg-canvas text-ink-muted border border-canvas-line")}>{t.due}</span>
                </li>
              ))}
            </ul>
          </div>

          {businessPlan && (
            <div className="card p-5">
              <SectionTitle>Business KPIs</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {businessPlan.kpis.map((k) => (
                  <div key={k.name} className="p-4 rounded-lg bg-canvas">
                    <div className="text-xs text-ink-muted">{k.name}</div>
                    <div className="text-lg font-display font-semibold text-ink mt-0.5">{k.target}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: next steps + services + vehicle */}
        <div className="space-y-6">
          <div className="card p-5 border-l-4 border-l-brand">
            <div className="eyebrow text-brand">Next steps</div>
            <ul className="mt-2 space-y-2">
              {NEXT_STEPS.map((s) => (
                <li key={s} className="text-sm text-ink-soft flex gap-2"><span className="text-brand">→</span>{s}</li>
              ))}
            </ul>
            <button className="btn-primary mt-4 w-full" onClick={() => nav(`/marketplace/${e.id}`)}>
              Find available opportunities
            </button>
          </div>

          {continuity && <ContinuityStatusCard status={continuity} />}

          <div className="card p-5">
            <SectionTitle>Business services</SectionTitle>
            <p className="text-xs text-ink-muted mb-3">{connected.length} of {services.length} coordinated by DSUSA</p>
            <ul className="space-y-2">
              {services.slice(0, 6).map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-ink">{s.name}</div>
                    <div className="text-xs text-ink-muted">{s.category}</div>
                  </div>
                  <span className={"pill " + serviceClass(s.status)}>{serviceLabel(s.status)}</span>
                </li>
              ))}
            </ul>
          </div>

          {vehicle && (
            <div className="card p-5">
              <SectionTitle>Vehicle</SectionTitle>
              <div className="font-semibold text-ink">{vehicle.vehicle}</div>
              <div className="text-sm text-ink-muted">{vehicle.businessClass}</div>
              <div className="mt-3 pill bg-signal-tint text-signal">{vehicleStageLabel(vehicle.stage)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const RECENT_ACTIVITY = [
  { text: "Load L-2980 delivered — Newark → Philadelphia", when: "2 hours ago" },
  { text: "Payment received: $612 net (waterfall settled)", when: "3 hours ago" },
  { text: "Fuel program discount applied — $48 saved", when: "Yesterday" },
  { text: "Insurance verified for Q1", when: "2 days ago" },
  { text: "Business banking account connected", when: "4 days ago" },
];
const UPCOMING_TASKS = [
  { label: "Accept next available load", due: "Today", urgent: true },
  { label: "Complete quarterly compliance check", due: "In 5 days", urgent: false },
  { label: "Review insurance renewal", due: "In 2 weeks", urgent: false },
];
const NEXT_STEPS = [
  "Browse the freight marketplace and accept a load",
  "Watch the payment waterfall settle your earnings",
  "Connect remaining business services",
];

function fundingLabel(s: string): string {
  return ({ requested: "Requested", submitted: "Submitted", under_review: "Under review", approved: "Approved", complete: "Complete" } as Record<string, string>)[s] ?? s;
}
function vehicleStageLabel(s: string): string {
  return ({ matching: "Matching", available: "Available", assigned: "Assigned", insured: "Insured", ready: "Ready for operation" } as Record<string, string>)[s] ?? s;
}
function serviceClass(s: string): string {
  return s === "connected" ? "bg-signal-tint text-signal" : s === "recommended" ? "bg-warn-tint text-warn" : "bg-canvas text-ink-muted border border-canvas-line";
}
function serviceLabel(s: string): string {
  return s === "connected" ? "Connected" : s === "recommended" ? "Recommended" : "Available";
}
