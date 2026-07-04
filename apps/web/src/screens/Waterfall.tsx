/**
 * Waterfall.tsx — Step 9. The centerpiece. One completed job pays the whole ecosystem.
 *
 * Tells the story, not just numbers: a customer payment cascades down through DSUSA settlement and
 * each ecosystem partner, and what remains lands with Maria. Legs reveal in sequence so the audience
 * watches the distribution happen and understands: "everyone is paid from one completed job."
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { PaymentWaterfall, WaterfallLeg } from "../data/domain.ts";
import { money, PagePurpose } from "../components/ui.tsx";

export function Waterfall() {
  const data = useData();
  const nav = useNavigate();
  const { entrepreneurId, loadId } = useParams();
  const eid = entrepreneurId ?? "maria";
  const [wf, setWf] = useState<PaymentWaterfall | null>(null);
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (loadId) void data.getWaterfall(loadId).then((w) => { setWf(w); setRevealed(0); });
  }, [loadId]);

  // Reveal legs one at a time to dramatize the cascade.
  useEffect(() => {
    if (!wf) return;
    if (revealed >= wf.legs.length) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), revealed === 0 ? 500 : 850);
    return () => clearTimeout(t);
  }, [wf, revealed]);

  const deductionsTotal = useMemo(
    () => (wf ? wf.legs.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0) : 0),
    [wf],
  );

  if (!wf) return <div className="text-ink-muted">Loading…</div>;
  const done = revealed >= wf.legs.length;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center">
        <div className="eyebrow">Payment Distribution</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">One job pays the whole ecosystem</h1>
        <PagePurpose>See how one completed job supports every participant in the ecosystem.</PagePurpose>
        <p className="text-ink-muted">Load {wf.loadId} · a single customer payment of {money(wf.customerPayment)} settles automatically across every partner.</p>
      </div>

      {/* The cascade */}
      <div className="card p-6">
        <div className="flex flex-col items-stretch gap-0">
          {wf.legs.map((leg, i) => (
            <WaterfallRow
              key={leg.party}
              leg={leg}
              shown={i < revealed}
              isLast={i === wf.legs.length - 1}
              runningGross={wf.customerPayment}
            />
          ))}
        </div>
      </div>

      {/* Summary */}
      {done && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Mini label="Customer paid" value={money(wf.customerPayment)} tone="ink" />
            <Mini label="To ecosystem partners" value={money(deductionsTotal)} tone="muted" />
            <Mini label="Maria keeps" value={money(wf.entrepreneurNet)} tone="signal" />
          </div>
          <div className="card p-5 text-center">
            <p className="text-ink-soft">
              Every partner — lender, insurer, warranty, fuel program, and DSUSA — was paid from this one
              completed job. The rest is Maria’s. No invoicing, no chasing payments: DSUSA settles it all.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button className="btn-ghost" onClick={() => nav(`/marketplace/${eid}`)}>Back to opportunities</button>
              <button className="btn-primary" onClick={() => nav(`/entrepreneur/${eid}`)}>Return to dashboard</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WaterfallRow({ leg, shown, isLast, runningGross }: { leg: WaterfallLeg; shown: boolean; isLast: boolean; runningGross: number }) {
  const pct = Math.round((leg.amount / runningGross) * 100);
  const tone =
    leg.kind === "gross" ? "bg-ink text-white" :
    leg.kind === "net" ? "bg-signal text-white" :
    "bg-canvas-panel border border-canvas-line text-ink";
  return (
    <div className={"transition-all duration-500 " + (shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2")}>
      <div className={"rounded-xl2 px-5 py-4 flex items-center justify-between " + tone}>
        <div>
          <div className="font-semibold">{leg.party}</div>
          <div className={"text-xs " + (leg.kind === "deduction" ? "text-ink-muted" : "text-white/70")}>
            {leg.kind === "gross" ? "Incoming payment" : leg.kind === "net" ? "Net earnings" : `${pct}% · coordinated by DSUSA`}
          </div>
        </div>
        <div className="font-display text-xl font-semibold tabular-nums">
          {leg.kind === "deduction" ? "−" : ""}{money(leg.amount)}
        </div>
      </div>
      {!isLast && (
        <div className="flex justify-center py-1">
          <span className={"text-lg " + (shown ? "text-track-now" : "text-transparent")}>↓</span>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: "ink" | "muted" | "signal" }) {
  const color = tone === "signal" ? "text-signal" : tone === "muted" ? "text-ink-muted" : "text-ink";
  return (
    <div className="card p-4 text-center">
      <div className="eyebrow">{label}</div>
      <div className={"font-display text-xl font-semibold mt-1 " + color}>{value}</div>
    </div>
  );
}
