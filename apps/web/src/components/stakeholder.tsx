/**
 * stakeholder.tsx — shared scaffolding for ecosystem stakeholder dashboards.
 *
 * Every stakeholder dashboard answers the same three questions, so they share a frame:
 *   1. What value does DSUSA create for me?
 *   2. What business opportunities do I receive?
 *   3. How does DSUSA make my job easier?
 * The headline answers "why should OUR organization join the DSUSA ecosystem?"
 */
import type { ReactNode } from "react";

export function StakeholderHeader({ role, org, thesis, purpose }: { role: string; org: string; thesis: string; purpose?: string }) {
  return (
    <div>
      <div className="eyebrow">{role} · Ecosystem Dashboard</div>
      <h1 className="font-display text-3xl font-semibold text-ink mt-1">{org}</h1>
      {purpose && <p className="text-ink-soft text-base mt-1 max-w-2xl">{purpose}</p>}
      <p className="text-ink-soft mt-1 max-w-2xl text-lg">{thesis}</p>
    </div>
  );
}

/** The three-question strip every stakeholder sees. */
export function ValueTriad({ value, opportunities, easier }: { value: string; opportunities: string; easier: string }) {
  const items: [string, string][] = [
    ["What value DSUSA creates", value],
    ["Opportunities you receive", opportunities],
    ["How your job gets easier", easier],
  ];
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {items.map(([k, v]) => (
        <div key={k} className="card p-5">
          <div className="eyebrow text-brand">{k}</div>
          <p className="text-sm text-ink-soft mt-2">{v}</p>
        </div>
      ))}
    </div>
  );
}

export function Takeaway({ children }: { children: ReactNode }) {
  return (
    <div className="card p-5 bg-brand text-white border-0">
      <div className="eyebrow text-white/70">The takeaway</div>
      <p className="font-display text-xl font-semibold mt-1">{children}</p>
    </div>
  );
}
