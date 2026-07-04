/**
 * Ecosystem.tsx — the closing slide. "The DSUSA Ecosystem."
 *
 * Entrepreneur at the center, partners arranged around them, simple relationship lines connecting each
 * to the center. The message: DSUSA does not replace these organizations — it helps them work together.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../data/context.tsx";
import type { BusinessContinuityCapability } from "../data/domain.ts";

interface Node { label: string; sub: string; }
const PARTNERS: Node[] = [
  { label: "Referral Partner", sub: "sends participants" },
  { label: "Lender", sub: "funds the business" },
  { label: "Dealer", sub: "supplies the vehicle" },
  { label: "Insurance", sub: "covers operations" },
  { label: "Warranty", sub: "protects the vehicle" },
  { label: "Fuel", sub: "lowers cost" },
  { label: "Freight", sub: "offers the work" },
  { label: "Dispatcher", sub: "optimizes routes" },
  { label: "Accounting", sub: "keeps the books" },
  { label: "Compliance", sub: "keeps it legal" },
];

export function Ecosystem() {
  const nav = useNavigate();
  const data = useData();
  const [cap, setCap] = useState<BusinessContinuityCapability | null>(null);
  useEffect(() => { void data.getContinuityCapability().then(setCap); }, []);
  // Radial layout in a 760×620 viewBox.
  const cx = 380, cy = 310, rx = 300, ry = 230;
  const points = PARTNERS.map((p, i) => {
    const angle = (i / PARTNERS.length) * Math.PI * 2 - Math.PI / 2;
    return { ...p, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="eyebrow">The closing picture</div>
        <h1 className="font-display text-4xl font-semibold text-ink mt-1">The DSUSA Ecosystem</h1>
        <p className="text-ink-soft text-base mt-2 max-w-2xl mx-auto">
          See how independent organizations work together through shared infrastructure.
        </p>
        <p className="text-ink-soft mt-2 max-w-2xl mx-auto text-lg">
          One entrepreneur at the center. Every organization they need, coordinated around them.
        </p>
      </div>

      <div className="card p-4">
        <svg viewBox="0 0 760 620" className="w-full h-auto" role="img" aria-label="DSUSA ecosystem diagram">
          {/* relationship lines */}
          {points.map((p) => (
            <line key={"l-" + p.label} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#C3CAD6" strokeWidth={1.5} />
          ))}
          {/* partner nodes */}
          {points.map((p) => (
            <g key={"n-" + p.label}>
              <rect x={p.x - 78} y={p.y - 26} width={156} height={52} rx={12}
                fill="#FFFFFF" stroke="#1D4E89" strokeWidth={1.5} />
              <text x={p.x} y={p.y - 4} textAnchor="middle" className="fill-ink" fontSize={14} fontWeight={600}>{p.label}</text>
              <text x={p.x} y={p.y + 13} textAnchor="middle" fill="#6B7689" fontSize={10}>{p.sub}</text>
            </g>
          ))}
          {/* center: entrepreneur */}
          <circle cx={cx} cy={cy} r={66} fill="#1D4E89" />
          <text x={cx} y={cy - 6} textAnchor="middle" fill="#FFFFFF" fontSize={15} fontWeight={700}>Entrepreneur</text>
          <text x={cx} y={cy + 13} textAnchor="middle" fill="#EAF1F9" fontSize={11}>the business owner</text>
          {/* Business Continuity label beneath the entrepreneur */}
          <text x={cx} y={cy + 92} textAnchor="middle" fill="#1B9C7A" fontSize={12} fontWeight={600}>
            Supported by DSUSA Business Continuity
          </text>
        </svg>
      </div>

      {/* Why Business Continuity Matters */}
      <div className="card p-8">
        <div className="text-center">
          <div className="eyebrow text-brand">Why Business Continuity Matters</div>
          <h2 className="font-display text-2xl font-semibold text-ink mt-1">Support that doesn’t end at launch</h2>
        </div>
        <div className="mt-4 max-w-3xl mx-auto space-y-3 text-ink-soft">
          <p>
            Traditional support often ends after funding or business launch. DSUSA is designed to coordinate
            ongoing operational support intended to help businesses remain productive throughout their lifecycle.
          </p>
          <p>Business Continuity is designed to protect the interests of every participant in the ecosystem:</p>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm pl-1">
            {["Entrepreneurs", "Referral Partners", "Lenders", "Dealers", "Insurance Partners", "Freight Partners", "Professional Service Providers"].map((p) => (
              <div key={p} className="flex gap-2"><span className="text-signal">•</span>{p}</div>
            ))}
          </div>
          <p className="font-medium text-ink pt-2">
            The objective is not simply to start businesses. The objective is to help businesses continue
            operating successfully.
          </p>
        </div>

        {cap && (
          <div className="mt-6 pt-6 border-t border-canvas-line">
            <div className="eyebrow text-center mb-3">Coordinated response types under this capability</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cap.responses.map((r) => (
                <div key={r.kind} className="p-4 rounded-lg bg-canvas">
                  <div className="font-semibold text-ink text-sm">{r.label}</div>
                  <p className="text-xs text-ink-muted mt-1">{r.description}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink-muted mt-4 text-center max-w-2xl mx-auto">
              Business Continuity provides infrastructure intended to coordinate operational responses. It does
              not guarantee repayment, recovery, reassignment, or any specific outcome, and is subject to legal,
              contractual, and operational requirements.
            </p>
          </div>
        )}
      </div>

      {/* Closing statement */}
      <div className="card p-8 text-center bg-ink text-white border-0">
        <p className="text-white/70 text-base mb-5 max-w-2xl mx-auto">
          Why organizations partner with DSUSA: every participant succeeds by helping entrepreneurs build
          sustainable businesses.
        </p>
        <p className="font-display text-2xl sm:text-3xl font-semibold leading-snug">
          DSUSA does not replace these organizations.<br />DSUSA helps them work together.
        </p>
        <div className="mt-5 flex flex-col items-center gap-1 text-white/80">
          <span>That is the business.</span>
          <span>That is the product.</span>
          <span>That is the platform.</span>
        </div>
      </div>

      <div className="flex justify-center">
        <button className="btn-ghost" onClick={() => nav("/")}>Restart the demonstration</button>
      </div>
    </div>
  );
}
