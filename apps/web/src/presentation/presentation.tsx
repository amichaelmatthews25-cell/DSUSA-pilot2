/**
 * presentation.tsx — Presentation Mode: a navigation layer only.
 *
 * Presentation Mode tells one entrepreneur's story (Maria) by walking the EXISTING routes in a fixed
 * order. It introduces no new business logic, no duplicated screens, no new data provider. It only:
 *   - defines the ordered sequence of existing routes,
 *   - tracks whether presentation mode is active (so standard nav hides and controls show),
 *   - provides Previous / Next / Exit + progress.
 *
 * Maria's fixed demo ids keep every step on her story.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** The protagonist's fixed identifiers, so every step renders Maria's story. */
export const DEMO = { entrepreneurId: "maria", partnerId: "defy", loadId: "L-3002" } as const;

export interface PresentationStep {
  readonly title: string;
  /** The existing route this step renders. No new pages. */
  readonly path: string;
}

/**
 * The guided sequence. Step 1 (Welcome) and the final step (Why Organizations Partner) are presentation
 * framing rendered by the layout; all other steps point at existing application routes.
 */
export const PRESENTATION_STEPS: readonly PresentationStep[] = [
  { title: "Welcome", path: "/present/welcome" },
  { title: "Referral Partner Dashboard", path: `/partner/${DEMO.partnerId}` },
  { title: "Applicant Portal", path: `/apply/${DEMO.entrepreneurId}` },
  { title: "Qualification", path: `/qualify/${DEMO.entrepreneurId}` },
  { title: "Business Creation", path: `/business/${DEMO.entrepreneurId}` },
  { title: "Capital Coordination", path: `/capital/${DEMO.entrepreneurId}` },
  { title: "Vehicle Assignment", path: `/vehicle/${DEMO.entrepreneurId}` },
  { title: "Entrepreneur Dashboard", path: `/entrepreneur/${DEMO.entrepreneurId}` },
  { title: "Freight Marketplace", path: `/marketplace/${DEMO.entrepreneurId}` },
  { title: "Payment Waterfall", path: `/waterfall/${DEMO.entrepreneurId}/${DEMO.loadId}` },
  { title: "Business Services Marketplace", path: "/services" },
  { title: "Referral Partner Impact", path: `/impact/${DEMO.partnerId}` },
  { title: "Lender Dashboard", path: "/lender" },
  { title: "Insurance Dashboard", path: "/insurance" },
  { title: "Freight Partner Dashboard", path: "/freight" },
  { title: "DSUSA Ecosystem", path: "/ecosystem" },
  { title: "Why Organizations Partner with DSUSA", path: "/present/why" },
];

interface PresentationState {
  readonly active: boolean;
  readonly stepIndex: number;
  start: () => void;
  exit: () => void;
  setStepByPath: (path: string) => void;
}

const PresentationContext = createContext<PresentationState | null>(null);

export function PresentationHost({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const value = useMemo<PresentationState>(() => ({
    active,
    stepIndex,
    start: () => { setActive(true); setStepIndex(0); },
    exit: () => { setActive(false); },
    setStepByPath: (path: string) => {
      const i = PRESENTATION_STEPS.findIndex((s) => s.path === path);
      if (i >= 0) setStepIndex(i);
    },
  }), [active, stepIndex]);

  return <PresentationContext.Provider value={value}>{children}</PresentationContext.Provider>;
}

export function usePresentation(): PresentationState {
  const ctx = useContext(PresentationContext);
  if (!ctx) throw new Error("usePresentation must be used within PresentationHost");
  return ctx;
}
