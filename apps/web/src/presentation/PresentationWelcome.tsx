/**
 * PresentationWelcome.tsx — the Presentation Mode landing page (step 1).
 * Framing only; reuses no business logic.
 */
import { useNavigate } from "react-router-dom";
import { usePresentation, PRESENTATION_STEPS } from "./presentation.tsx";

export function PresentationWelcome() {
  const nav = useNavigate();
  const { start } = usePresentation();

  function begin() {
    start();
    nav(PRESENTATION_STEPS[1]!.path);
  }

  return (
    <div className="min-h-[70vh] grid place-items-center">
      <div className="max-w-2xl text-center">
        <div className="eyebrow">A DSUSA case study</div>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-ink mt-2 leading-tight">
          Maria’s Journey to Business Ownership
        </h1>
        <p className="text-ink-soft text-lg mt-3">
          Follow one entrepreneur from referral to operating business through the DSUSA ecosystem.
        </p>

        <div className="card p-6 mt-8 text-left grid sm:grid-cols-2 gap-x-8 gap-y-4">
          <Field label="Referral Partner" value="Defy Ventures" />
          <Field label="Entrepreneur" value="Maria Rodriguez" />
          <Field label="Business Class" value="Cargo Van" />
          <Field label="Business Status" value="Preparing for Operations" />
        </div>

        <button className="btn-primary mt-8 px-8 py-3 text-base" onClick={begin}>
          Begin Presentation
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="font-display text-xl font-semibold text-ink mt-0.5">{value}</div>
    </div>
  );
}
