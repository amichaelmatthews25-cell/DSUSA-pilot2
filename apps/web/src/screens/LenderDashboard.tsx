/**
 * LenderDashboard.tsx — ecosystem view for the lender.
 * Answer: "My portfolio is actively managed."
 */
import { useEffect, useState } from "react";
import { useData } from "../data/context.tsx";
import type { LenderDashboardData } from "../data/domain.ts";
import { Stat, SectionTitle, money } from "../components/ui.tsx";
import { StakeholderHeader, ValueTriad, Takeaway } from "../components/stakeholder.tsx";

export function LenderDashboard() {
  const data = useData();
  const [d, setD] = useState<LenderDashboardData | null>(null);
  useEffect(() => { void data.getLenderDashboard().then(setD); }, []);
  if (!d) return <div className="text-ink-muted">Loading…</div>;

  const healthLabel = { strong: "Strong", stable: "Stable", watch: "Watch" }[d.portfolioHealth];
  const healthClass = { strong: "bg-signal-tint text-signal", stable: "bg-brand-tint text-brand", watch: "bg-warn-tint text-warn" }[d.portfolioHealth];

  return (
    <div className="space-y-6">
      <StakeholderHeader role="Lender" org="DSUSA Capital Partner" purpose="Monitor businesses through coordinated operational oversight."
        thesis="You don't just write loans into the dark. DSUSA actively manages the businesses you fund — and repayment is built into every completed job." />

      <ValueTriad
        value="Capital is deployed into vetted, qualified businesses with a generated operating plan and coordinated insurance — not unsupported sole proprietors."
        opportunities="A steady pipeline of pre-qualified funding applications, each tied to a business DSUSA helps succeed."
        easier="Repayment auto-deducts through the payment waterfall on every load. No invoicing, no chasing — and early-warning interventions when a business needs help."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Applications" value={d.applications} sub="pre-qualified" />
        <Stat label="Businesses funded" value={d.funded} sub="active loans" />
        <Stat label="Outstanding portfolio" value={money(d.outstandingPortfolio)} sub="principal at work" />
        <Stat label="On-time payments" value={`${d.onTimePaymentRate}%`} sub="via waterfall" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-5">
          <SectionTitle>Portfolio health</SectionTitle>
          <div className={"pill " + healthClass}>{healthLabel}</div>
          <p className="text-sm text-ink-soft mt-3">
            Payments are recovered automatically from each completed job before funds reach the entrepreneur.
            That structural seniority is why on-time performance stays high.
          </p>
        </div>

        <div className="card p-5">
          <SectionTitle>Payment waterfall history</SectionTitle>
          <ul className="divide-y divide-canvas-line">
            {d.waterfallSettlements.map((w) => (
              <li key={w.loadId} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="text-ink font-medium">{w.loadId}</div>
                  <div className="text-xs text-ink-muted">{w.date}</div>
                </div>
                <div className="text-signal font-semibold">+{money(w.toLender)}</div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted mt-2">Each row is a loan payment recovered from a completed load.</p>
        </div>

        <div className="card p-5">
          <SectionTitle>Active interventions</SectionTitle>
          <ul className="space-y-3">
            {d.interventions.map((i) => (
              <li key={i.business} className="text-sm">
                <div className="text-ink font-medium">{i.business}</div>
                <div className="text-ink-soft">{i.action}</div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted mt-3">DSUSA acts before a missed payment becomes a default.</p>
        </div>
      </div>

      <Takeaway>Your portfolio isn't just monitored — it's actively managed, and every completed job pays you first.</Takeaway>

      {/* Problems DSUSA helps solve */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <SectionTitle>Problems DSUSA helps solve</SectionTitle>
          <ul className="space-y-3 text-sm">
            <Problem text="Extended downtime when financed commercial assets stop generating revenue." />
            <Problem text="Limited operational visibility after funding." />
            <Problem text="Difficulty coordinating responses when an entrepreneur exits or can no longer operate." />
          </ul>
        </div>
        <div className="card p-6">
          <SectionTitle>Value created</SectionTitle>
          <ul className="space-y-3 text-sm">
            <Value text="Business Continuity monitoring." />
            <Value text="Coordinated operational oversight." />
            <Value text="Structured intervention workflows." />
            <Value text="A standardized process designed to restore productive commercial activity within the DSUSA ecosystem as quickly as legally and contractually possible." />
          </ul>
          <p className="text-[11px] text-ink-muted mt-4">
            Business Continuity provides infrastructure intended to coordinate operational responses. It does
            not guarantee repayment, recovery, or any specific outcome, and is subject to legal, contractual,
            and operational requirements.
          </p>
        </div>
      </div>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <li className="flex gap-2.5">
      <span className="text-warn mt-0.5 shrink-0">⚠</span>
      <span className="text-ink-soft">{text}</span>
    </li>
  );
}
function Value({ text }: { text: string }) {
  return (
    <li className="flex gap-2.5">
      <span className="text-signal mt-0.5 shrink-0">✓</span>
      <span className="text-ink-soft">{text}</span>
    </li>
  );
}
