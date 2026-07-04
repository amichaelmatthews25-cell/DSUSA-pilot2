/**
 * Qualification.tsx — Step 3. Qualification runs and assigns a business class.
 * Application received -> Qualification review -> Result -> Business Class Assignment.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { Entrepreneur } from "../data/domain.ts";
import { JourneyTracker, NextStep, PagePurpose } from "../components/ui.tsx";

type Phase = "received" | "reviewing" | "result";

export function Qualification() {
  const data = useData();
  const nav = useNavigate();
  const { entrepreneurId } = useParams();
  const [e, setE] = useState<Entrepreneur | null>(null);
  const [phase, setPhase] = useState<Phase>("received");

  useEffect(() => {
    if (entrepreneurId) void data.getEntrepreneur(entrepreneurId).then(setE);
  }, [entrepreneurId]);

  async function runReview() {
    if (!entrepreneurId) return;
    setPhase("reviewing");
    // Brief, honest pause to show review happening — then deterministic result.
    await new Promise((r) => setTimeout(r, 1400));
    const updated = await data.runQualification(entrepreneurId);
    setE(updated);
    setPhase("result");
  }

  if (!e) return <div className="text-ink-muted">Loading…</div>;

  const checks = [
    { label: "Identity verified", done: true },
    { label: "Referral partner confirmed", done: true },
    { label: "Documents complete", done: true },
    { label: "Eligibility assessed", done: phase === "result" },
    { label: "Business class matched", done: phase === "result" },
  ];

  return (
    <div className="space-y-6">
      <JourneyTracker current={phase === "result" ? "qualified" : "qualifying"} />
      <div>
        <div className="eyebrow">Qualification</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">Reviewing {e.name}’s application</h1>
        <PagePurpose>DSUSA evaluates business readiness and determines the support required for success.</PagePurpose>
        <p className="text-ink-muted">DSUSA evaluates eligibility and matches a business class. A reviewer confirms the final decision.</p>
      </div>

      <div className="card p-6">
        <ol className="space-y-3">
          {checks.map((c, i) => (
            <li key={c.label} className="flex items-center gap-3">
              <span className={"h-6 w-6 rounded-full grid place-items-center text-xs font-bold " +
                (c.done ? "bg-signal text-white" : phase === "reviewing" && i >= 3 ? "bg-brand-tint text-brand animate-pulse" : "bg-canvas text-ink-muted border border-canvas-line")}>
                {c.done ? "✓" : i + 1}
              </span>
              <span className={"text-sm " + (c.done ? "text-ink font-medium" : "text-ink-muted")}>{c.label}</span>
            </li>
          ))}
        </ol>

        {phase === "received" && (
          <button className="btn-primary mt-6" onClick={runReview}>Run qualification review</button>
        )}
        {phase === "reviewing" && (
          <p className="text-sm text-brand mt-6 font-medium">Reviewing eligibility and matching a business class…</p>
        )}
      </div>

      {phase === "result" && e.qualification === "approved" && (
        <>
          <div className="card p-6 border-l-4 border-l-signal">
            <div className="eyebrow text-signal">Qualification result</div>
            <h2 className="font-display text-2xl font-semibold text-ink mt-1">Approved</h2>
            <p className="text-ink-soft mt-1">{e.name} is approved to operate as a DSUSA entrepreneur.</p>
            <div className="mt-4 p-4 rounded-lg bg-brand-tint">
              <div className="eyebrow text-brand">Business class assigned</div>
              <div className="font-display text-xl font-semibold text-ink mt-0.5">{e.businessClass?.label}</div>
              <p className="text-sm text-ink-soft mt-0.5">{e.businessClass?.description}</p>
            </div>
            <div className="mt-4 flex gap-2 flex-wrap">
              <span className="pill bg-canvas text-ink-muted border border-canvas-line">Cargo Van</span>
              <span className="pill bg-canvas text-ink-muted border border-canvas-line">Box Truck</span>
              <span className="pill bg-canvas text-ink-muted border border-canvas-line">More classes coming</span>
            </div>
          </div>
          <NextStep
            title="DSUSA builds Maria’s business"
            body="Now DSUSA automatically generates Maria’s business profile, budget, revenue model, and operating plan — she doesn’t build these herself."
            cta={<button className="btn-primary" onClick={() => nav(`/business/${entrepreneurId}`)}>See DSUSA build the business</button>}
          />
        </>
      )}
    </div>
  );
}
