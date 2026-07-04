/**
 * ServicesEcosystem.tsx — the Business Services Marketplace, framed as an ecosystem (not a directory).
 *
 * Each provider explains: what they provide, why entrepreneurs need them, how they integrate into DSUSA,
 * and how to join. Reinforces that DSUSA *coordinates* professional services.
 */
import { useEffect, useState } from "react";
import { useData } from "../data/context.tsx";
import type { ServiceEcosystemEntry } from "../data/domain.ts";
import { PagePurpose } from "../components/ui.tsx";

export function ServicesEcosystem() {
  const data = useData();
  const [items, setItems] = useState<readonly ServiceEcosystemEntry[]>([]);
  useEffect(() => { void data.listServiceEcosystem().then(setItems); }, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Business Services</div>
        <h1 className="font-display text-3xl font-semibold text-ink mt-1">The DSUSA services ecosystem</h1>
        <PagePurpose>Access the professional services that support your business.</PagePurpose>
        <p className="text-ink-soft mt-1 max-w-2xl text-lg">
          DSUSA doesn't sell these services — it coordinates them. Each partner plugs into the entrepreneur's
          journey at exactly the right moment, so a new business owner has everything they need without
          assembling it themselves.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {items.map((s) => (
          <div key={s.id} className="card p-6">
            <div className="flex items-center justify-between">
              <div className="eyebrow text-brand">{s.category}</div>
              <span className={"pill " + statusClass(s.status)}>{statusLabel(s.status)}</span>
            </div>
            <h2 className="font-display text-xl font-semibold text-ink mt-1">{s.name}</h2>

            <dl className="mt-4 space-y-3 text-sm">
              <Block label="What they provide" body={s.provides} />
              <Block label="Why entrepreneurs need them" body={s.whyNeeded} />
              <Block label="How they integrate into DSUSA" body={s.integration} />
            </dl>

            <div className="mt-4 pt-4 border-t border-canvas-line flex items-center justify-between">
              <span className="text-xs text-ink-muted">Coordinated through the DSUSA platform</span>
              <button className="btn-ghost text-sm">Join the ecosystem</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-6 bg-brand text-white border-0 text-center">
        <p className="font-display text-xl font-semibold">
          DSUSA coordinates professional services so entrepreneurs don't have to.
        </p>
        <p className="text-white/80 text-sm mt-1">One platform. Every service a new business needs. Working together.</p>
      </div>
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink-soft mt-0.5">{body}</dd>
    </div>
  );
}

function statusClass(s: string): string {
  return s === "connected" ? "bg-signal-tint text-signal" : s === "recommended" ? "bg-warn-tint text-warn" : "bg-canvas text-ink-muted border border-canvas-line";
}
function statusLabel(s: string): string {
  return s === "connected" ? "Connected" : s === "recommended" ? "Recommended" : "Available";
}
