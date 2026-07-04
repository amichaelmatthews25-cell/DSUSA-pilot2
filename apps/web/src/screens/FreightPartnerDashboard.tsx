/**
 * FreightPartnerDashboard.tsx — ecosystem view for the freight partner.
 * Answer: "DSUSA creates reliable capacity."
 */
import { useEffect, useState } from "react";
import { useData } from "../data/context.tsx";
import type { FreightPartnerDashboardData } from "../data/domain.ts";
import { Stat, SectionTitle } from "../components/ui.tsx";
import { StakeholderHeader, ValueTriad, Takeaway } from "../components/stakeholder.tsx";

export function FreightPartnerDashboard() {
  const data = useData();
  const [d, setD] = useState<FreightPartnerDashboardData | null>(null);
  useEffect(() => { void data.getFreightPartnerDashboard().then(setD); }, []);
  if (!d) return <div className="text-ink-muted">Loading…</div>;

  const acceptRate = Math.round((d.loadsAccepted / d.loadsPosted) * 100);

  return (
    <div className="space-y-6">
      <StakeholderHeader role="Freight Partner" org="Eastern Freight Exchange" purpose="Connect available freight with supported business operators."
        thesis="Finding reliable capacity is the hard part of freight. DSUSA gives you a vetted, insured, performance-tracked fleet ready to accept your loads." />

      <ValueTriad
        value="A pool of qualified, insured owner-operators with matched vehicles — reliable capacity instead of one-off carriers."
        opportunities="Your posted loads reach compatible businesses instantly, with high acceptance and completion rates."
        easier="DSUSA coordinates compatibility, insurance, and payment settlement — you post opportunities, the ecosystem handles the rest."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Businesses available" value={d.businessesAvailable} sub="ready to haul" />
        <Stat label="Capacity" value={`${d.capacityVehicles}`} sub="vehicles in network" />
        <Stat label="Loads posted" value={d.loadsPosted} sub="all time" />
        <Stat label="Loads accepted" value={d.loadsAccepted} sub={`${acceptRate}% acceptance`} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-5">
          <SectionTitle>Completion rate</SectionTitle>
          <div className="stat text-signal">{d.completionRate}%</div>
          <p className="text-sm text-ink-soft mt-2">
            Loads accepted through DSUSA get completed — because the operators are vetted, insured, and supported.
          </p>
        </div>
        <div className="card p-5">
          <SectionTitle>Average delivery performance</SectionTitle>
          <div className="stat text-signal">{d.avgDeliveryPerformance}%</div>
          <p className="text-sm text-ink-soft mt-2">
            On-time delivery across the network. Reliable capacity you can plan around.
          </p>
        </div>
      </div>

      <Takeaway>DSUSA turns scattered owner-operators into reliable capacity you can count on.</Takeaway>
    </div>
  );
}
