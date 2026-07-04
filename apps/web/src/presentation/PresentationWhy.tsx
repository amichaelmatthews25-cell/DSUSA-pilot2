/**
 * PresentationWhy.tsx — the Presentation Mode closing slide (final step).
 * Framing only; restates the ecosystem thesis for the partner audience.
 */
export function PresentationWhy() {
  const participants = [
    "Entrepreneurs", "Referral Partners", "Lenders", "Dealers",
    "Insurance Partners", "Freight Partners", "Professional Service Providers",
  ];
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <div className="eyebrow text-brand">The closing thought</div>
        <h1 className="font-display text-4xl font-semibold text-ink mt-1">Why Organizations Partner with DSUSA</h1>
        <p className="text-ink-soft text-lg mt-3">
          Every participant succeeds by helping entrepreneurs build sustainable businesses.
        </p>
      </div>

      <div className="card p-8 space-y-4 text-ink-soft">
        <p>
          Maria’s story is one path through the ecosystem — but every organization that touched her journey
          shared in the outcome. The referral partner saw a participant become a business owner. The lender
          deployed capital into a managed, operating business. The insurer, dealer, fuel program, and freight
          partner each gained a reliable, coordinated relationship.
        </p>
        <p>
          DSUSA is the infrastructure that lets these independent organizations work together — designed to
          help businesses begin operating and to help them remain productive over time, subject to legal,
          contractual, and operational requirements.
        </p>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 pt-2">
          {participants.map((p) => (
            <div key={p} className="flex gap-2 text-sm"><span className="text-signal">•</span>{p}</div>
          ))}
        </div>
      </div>

      <div className="card p-8 text-center bg-ink text-white border-0">
        <p className="font-display text-2xl sm:text-3xl font-semibold leading-snug">
          DSUSA does not replace these organizations.<br />DSUSA helps them work together.
        </p>
        <div className="mt-5 flex flex-col items-center gap-1 text-white/80">
          <span>That is the business.</span>
          <span>That is the product.</span>
          <span>That is the platform.</span>
        </div>
      </div>
    </div>
  );
}
