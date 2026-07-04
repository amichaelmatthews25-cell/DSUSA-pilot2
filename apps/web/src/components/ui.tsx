/**
 * ui.tsx — small, shared presentation primitives used across the journey.
 * Clarity over decoration: a stage tracker, stat blocks, status pills, currency.
 */
import type { ReactNode } from "react";
import { JOURNEY_STAGES, STAGE_LABEL, type JourneyStage } from "../data/domain.ts";

export function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** The spine of the demo: a horizontal tracker showing where the entrepreneur is. */
export function JourneyTracker({ current }: { current: JourneyStage }) {
  const curIdx = JOURNEY_STAGES.indexOf(current);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto py-1" aria-label="Journey progress">
      {JOURNEY_STAGES.map((s, i) => {
        const state = i < curIdx ? "done" : i === curIdx ? "now" : "next";
        return (
          <li key={s} className="flex items-center gap-1 shrink-0">
            <span
              className={
                "pill " +
                (state === "done" ? "bg-signal-tint text-signal" :
                 state === "now" ? "bg-brand text-white" :
                 "bg-canvas text-ink-muted border border-canvas-line")
              }
            >
              {state === "done" ? "✓ " : ""}{STAGE_LABEL[s]}
            </span>
            {i < JOURNEY_STAGES.length - 1 && (
              <span className={"h-px w-4 " + (i < curIdx ? "bg-track-done" : "bg-track-next")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="eyebrow">{label}</div>
      <div className="stat mt-1">{value}</div>
      {sub && <div className="text-sm text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-3">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function HealthPill({ health }: { health: "starting" | "healthy" | "watch" }) {
  const map = {
    healthy: "bg-signal-tint text-signal",
    starting: "bg-brand-tint text-brand",
    watch: "bg-warn-tint text-warn",
  } as const;
  const label = { healthy: "Healthy", starting: "Getting started", watch: "Needs attention" }[health];
  return <span className={"pill " + map[health]}>{label}</span>;
}

export function NextStep({ title, body, cta }: { title: string; body: string; cta?: ReactNode }) {
  return (
    <div className="card p-5 border-l-4 border-l-brand">
      <div className="eyebrow text-brand">What happens next</div>
      <div className="font-semibold text-ink mt-1">{title}</div>
      <p className="text-sm text-ink-soft mt-1">{body}</p>
      {cta && <div className="mt-3">{cta}</div>}
    </div>
  );
}

/** One-sentence "why am I looking at this?" shown near the top of every major screen. */
export function PagePurpose({ children }: { children: ReactNode }) {
  return <p className="text-ink-soft text-base mt-1 max-w-2xl">{children}</p>;
}
