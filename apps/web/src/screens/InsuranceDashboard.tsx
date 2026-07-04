/**
 * InsuranceDashboard.tsx — ecosystem view for the insurance partner.
 * Answer: "This platform grows my book of business."
 */
import { useEffect, useState } from "react";
import { useData } from "../data/context.tsx";
import type { InsuranceDashboardData } from "../data/domain.ts";
import { Stat, SectionTitle, money } from "../components/ui.tsx";
import { StakeholderHeader, ValueTriad, Takeaway } from "../components/stakeholder.tsx";

export function InsuranceDashboard() {
  const data = useData();
  const [d, setD] = useState<InsuranceDashboardData | null>(null);
  useEffect(() => { void data.getInsuranceDashboard().then(setD); }, []);
  if (!d) return <div className="text-ink-muted">Loading…</div>;

  return (
    <div className="space-y-6">
      <StakeholderHeader role="Insurance Partner" org="Atlas Commercial Coverage" purpose="Grow your commercial portfolio through qualified businesses."
        thesis="Every entrepreneur DSUSA creates is a new policyholder who needs commercial coverage from day one — and renews as long as they operate." />

      <ValueTriad
        value="A continuous flow of new commercial-auto and cargo policyholders, each required to carry coverage to operate."
        opportunities="New businesses needing coverage the moment they're created, plus add-on and renewal opportunities across the operating fleet."
        easier="Policies activate automatically at vehicle assignment and premiums settle through the payment waterfall — less paperwork, fewer lapses."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Businesses insured" value={d.insured} sub="active policyholders" />
        <Stat label="Active policies" value={d.activePolicies} sub="auto + cargo" />
        <Stat label="Renewals due" value={d.renewalsDue} sub="next 60 days" />
        <Stat label="Premium volume" value={money(d.premiumVolume)} sub="annualized" />
      </div>

      <div className="card p-5">
        <SectionTitle>New opportunities</SectionTitle>
        <ul className="divide-y divide-canvas-line">
          {d.newOpportunities.map((o) => (
            <li key={o.business} className="flex items-center justify-between py-3">
              <div>
                <div className="text-ink font-medium">{o.business}</div>
                <div className="text-xs text-ink-muted">{o.product}</div>
              </div>
              <span className="pill bg-brand-tint text-brand">New</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted mt-3">
          Each newly created DSUSA business is a coverage opportunity surfaced to you automatically.
        </p>
      </div>

      <Takeaway>Every business DSUSA creates grows your book — and the platform keeps the policies active.</Takeaway>
    </div>
  );
}
