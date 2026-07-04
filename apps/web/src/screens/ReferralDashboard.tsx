/**
 * ReferralDashboard.tsx — Step 1. The referral partner's home.
 * Defy Ventures sees their submitted entrepreneurs and submits Maria into DSUSA.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { Entrepreneur, ReferralPartner } from "../data/domain.ts";
import { STAGE_LABEL } from "../data/domain.ts";
import { Stat, SectionTitle, NextStep, PagePurpose } from "../components/ui.tsx";

export function ReferralDashboard() {
  const data = useData();
  const nav = useNavigate();
  const { partnerId } = useParams();
  const activePartnerId = partnerId ?? "defy";

  const [partner, setPartner] = useState<ReferralPartner | null>(null);
  const [partners, setPartners] = useState<readonly ReferralPartner[]>([]);
  const [people, setPeople] = useState<readonly Entrepreneur[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    const [p, all, list] = await Promise.all([
      data.getReferralPartner(activePartnerId),
      data.listReferralPartners(),
      data.listEntrepreneursForPartner(activePartnerId),
    ]);
    setPartner(p);
    setPartners(all);
    setPeople(list);
  }
  useEffect(() => { void refresh(); }, [activePartnerId]);

  const maria = people.find((e) => e.id === "maria");

  async function submitMaria() {
    setSubmitting(true);
    const created = await data.submitApplicant(activePartnerId, {
      fullName: "Maria Rodriguez",
      email: "maria.rodriguez@example.com",
      phone: "(718) 555-0147",
      hasExistingEntity: false,
      entityType: "sole_proprietor",
      documentsProvided: [],
    });
    setSubmitting(false);
    nav(`/apply/${created.id}`);
  }

  if (!partner) return <div className="text-ink-muted">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Partner switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        {partners.map((p) => (
          <button
            key={p.id}
            onClick={() => nav(p.id === "defy" ? "/" : `/partner/${p.id}`)}
            className={"pill " + (p.id === activePartnerId ? "bg-brand text-white" : "bg-canvas-panel border border-canvas-line text-ink-soft")}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Partner header */}
      <div>
        <div className="eyebrow">Referral Partner Dashboard</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">{partner.name}</h1>
        <PagePurpose>Track how your referrals progress from applicant to operating business.</PagePurpose>
        <p className="text-ink-muted">{partner.kind}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Submitted" value={partner.submittedCount} sub="entrepreneurs referred" />
        <Stat label="Operating" value={partner.operatingCount} sub="now running a business" />
        <Stat label="Success rate" value={`${Math.round((partner.operatingCount / partner.submittedCount) * 100)}%`} sub="referred → operating" />
      </div>

      {/* Submit Maria — the demo's opening action */}
      {(!maria || maria.stage === "referred") && (
        <NextStep
          title="Submit Maria Rodriguez to DSUSA"
          body="Maria came to Defy Ventures looking to start her own business. Submit her into the DSUSA ecosystem to begin her application."
          cta={
            <button className="btn-primary" onClick={submitMaria} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit applicant"}
            </button>
          }
        />
      )}
      {maria && maria.stage !== "referred" && (
        <NextStep
          title="Maria is in the DSUSA pipeline"
          body="Continue Maria's journey — pick up where she is in the process."
          cta={<button className="btn-primary" onClick={() => nav(routeForStage(maria))}>Continue Maria’s journey</button>}
        />
      )}

      {/* Submitted entrepreneurs */}
      <div>
        <SectionTitle>Your entrepreneurs</SectionTitle>
        <div className="card divide-y divide-canvas-line">
          {people.length === 0 && <div className="p-5 text-ink-muted">No submissions yet.</div>}
          {people.map((e) => (
            <button
              key={e.id}
              onClick={() => nav(routeForStage(e))}
              className="w-full text-left p-4 flex items-center justify-between hover:bg-canvas"
            >
              <div className="flex items-center gap-3">
                <span className="h-9 w-9 rounded-full bg-brand-tint text-brand grid place-items-center font-semibold">
                  {e.name.split(" ").map((n) => n[0]).join("")}
                </span>
                <div>
                  <div className="font-semibold text-ink">{e.name}</div>
                  <div className="text-sm text-ink-muted">{e.businessClass?.label ?? "Business class pending"}</div>
                </div>
              </div>
              <span className={"pill " + stagePillClass(e.stage)}>{STAGE_LABEL[e.stage]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function routeForStage(e: Entrepreneur): string {
  switch (e.stage) {
    case "referred": return `/apply/${e.id}`;
    case "applying": return `/apply/${e.id}`;
    case "qualifying": return `/qualify/${e.id}`;
    case "qualified": return `/business/${e.id}`;
    case "business_created":
    case "vehicle_assigned":
    case "operating": return `/entrepreneur/${e.id}`;
    default: return `/entrepreneur/${e.id}`;
  }
}

function stagePillClass(stage: Entrepreneur["stage"]): string {
  if (stage === "operating") return "bg-signal-tint text-signal";
  if (stage === "referred") return "bg-canvas text-ink-muted border border-canvas-line";
  return "bg-brand-tint text-brand";
}
