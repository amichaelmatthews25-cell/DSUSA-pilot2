/**
 * PresentationControls.tsx — the only navigation shown in Presentation Mode.
 * Previous / Next / Exit + progress ("Step 4 of 17 · Business Creation").
 * Drives navigation through the existing routes in the predefined order.
 */
import { useNavigate, useLocation } from "react-router-dom";
import { usePresentation, PRESENTATION_STEPS } from "./presentation.tsx";

export function PresentationControls() {
  const nav = useNavigate();
  const loc = useLocation();
  const { exit } = usePresentation();

  // Derive current step from the actual path so progress stays correct even if the
  // user lands mid-sequence. Falls back to matching by route prefix for param routes.
  const idx = currentStepIndex(loc.pathname);
  const total = PRESENTATION_STEPS.length;
  const step = PRESENTATION_STEPS[idx] ?? PRESENTATION_STEPS[0]!;

  const goPrev = () => { if (idx > 0) nav(PRESENTATION_STEPS[idx - 1]!.path); };
  const goNext = () => { if (idx < total - 1) nav(PRESENTATION_STEPS[idx + 1]!.path); };
  const doExit = () => { exit(); nav("/"); };

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-canvas-line bg-canvas-panel/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <button className="btn-ghost" onClick={goPrev} disabled={idx === 0} aria-label="Previous step">
          ← Previous
        </button>

        <div className="text-center min-w-0">
          <div className="text-xs text-ink-muted">Step {idx + 1} of {total}</div>
          <div className="text-sm font-semibold text-ink truncate">{step.title}</div>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-ghost text-ink-muted" onClick={doExit} aria-label="Exit presentation">
            Exit
          </button>
          <button className="btn-primary" onClick={goNext} disabled={idx === total - 1} aria-label="Next step">
            Next →
          </button>
        </div>
      </div>
      {/* progress bar */}
      <div className="h-1 bg-canvas">
        <div className="h-full bg-brand transition-all" style={{ width: `${((idx + 1) / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** Map the current pathname to a step index, handling param routes by prefix. */
function currentStepIndex(pathname: string): number {
  // exact match first
  const exact = PRESENTATION_STEPS.findIndex((s) => s.path === pathname);
  if (exact >= 0) return exact;
  // prefix match for param routes (e.g. /waterfall/maria/L-3002)
  const byPrefix = PRESENTATION_STEPS.findIndex((s) => {
    const base = "/" + s.path.split("/")[1];
    return base.length > 1 && pathname.startsWith(base);
  });
  return byPrefix >= 0 ? byPrefix : 0;
}
