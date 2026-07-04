/**
 * Application.tsx — Step 2. Maria completes her application.
 * Application -> Identity -> Business Entity (default Sole Proprietor) -> Documents -> Submit.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { Entrepreneur } from "../data/domain.ts";
import { JourneyTracker, SectionTitle, PagePurpose } from "../components/ui.tsx";

const DOCS = ["Government ID", "Proof of address", "Driver's license", "Signed participation agreement"];

export function Application() {
  const data = useData();
  const nav = useNavigate();
  const { entrepreneurId } = useParams();
  const [e, setE] = useState<Entrepreneur | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [entity, setEntity] = useState<"sole_proprietor" | "existing">("sole_proprietor");

  useEffect(() => {
    if (entrepreneurId) void data.getEntrepreneur(entrepreneurId).then(setE);
  }, [entrepreneurId]);

  if (!e) return <div className="text-ink-muted">Loading…</div>;
  const allDocsChecked = DOCS.every((d) => checked[d]);

  async function submit() {
    if (!entrepreneurId) return;
    // Advance to qualifying by re-submitting the completed application.
    await data.submitApplicant(e!.referralPartnerId, {
      fullName: e!.name, email: "maria.rodriguez@example.com", phone: "(718) 555-0147",
      hasExistingEntity: entity === "existing", entityType: entity,
      documentsProvided: DOCS.filter((d) => checked[d]),
    });
    nav(`/qualify/${entrepreneurId}`);
  }

  return (
    <div className="space-y-6">
      <JourneyTracker current="applying" />
      <div>
        <div className="eyebrow">Applicant Portal</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">{e.name}’s application</h1>
        <PagePurpose>Begin your journey to business ownership through the DSUSA ecosystem.</PagePurpose>
        <p className="text-ink-muted">Referred by Defy Ventures · let’s get the essentials in place.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Identity */}
        <div className="card p-5">
          <SectionTitle>Identity</SectionTitle>
          <dl className="space-y-2 text-sm">
            <Row k="Full name" v={e.name} />
            <Row k="Email" v="maria.rodriguez@example.com" />
            <Row k="Phone" v="(718) 555-0147" />
            <Row k="Referral partner" v="Defy Ventures" />
          </dl>
          <p className="text-xs text-ink-muted mt-3">Identity verified through the referral partner.</p>
        </div>

        {/* Business entity */}
        <div className="card p-5">
          <SectionTitle>Business entity</SectionTitle>
          <p className="text-sm text-ink-soft mb-3">DSUSA defaults new entrepreneurs to a Sole Proprietorship. You can bring an existing entity instead.</p>
          <div className="space-y-2">
            <EntityOption label="Sole Proprietor" desc="Recommended default — fastest path to operating." selected={entity === "sole_proprietor"} onClick={() => setEntity("sole_proprietor")} />
            <EntityOption label="Use an existing entity" desc="I already have an LLC or corporation." selected={entity === "existing"} onClick={() => setEntity("existing")} />
          </div>
        </div>
      </div>

      {/* Documents */}
      <div className="card p-5">
        <SectionTitle>Required documents</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-2">
          {DOCS.map((d) => (
            <label key={d} className="flex items-center gap-3 p-3 rounded-lg border border-canvas-line cursor-pointer hover:bg-canvas">
              <input type="checkbox" checked={!!checked[d]} onChange={() => setChecked((c) => ({ ...c, [d]: !c[d] }))} className="h-4 w-4 accent-[#1D4E89]" />
              <span className="text-sm text-ink">{d}</span>
              {checked[d] && <span className="pill bg-signal-tint text-signal ml-auto">Provided</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">{allDocsChecked ? "All documents provided." : "Provide all documents to submit."}</p>
        <button className="btn-primary" onClick={submit} disabled={!allDocsChecked}>Submit application</button>
      </div>
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

function EntityOption({ label, desc, selected, onClick }: { label: string; desc: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={"w-full text-left p-3 rounded-lg border " + (selected ? "border-brand bg-brand-tint" : "border-canvas-line hover:bg-canvas")}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink">{label}</span>
        <span className={"h-4 w-4 rounded-full border-2 " + (selected ? "border-brand bg-brand" : "border-canvas-line")} />
      </div>
      <p className="text-xs text-ink-muted mt-0.5">{desc}</p>
    </button>
  );
}
