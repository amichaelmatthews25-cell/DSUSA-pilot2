/**
 * App.tsx — the DSUSA app shell + routes.
 *
 * One continuous experience: every route advances Maria's story and points to what's next.
 */
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { ReferralDashboard } from "./screens/ReferralDashboard.tsx";
import { Application } from "./screens/Application.tsx";
import { Qualification } from "./screens/Qualification.tsx";
import { BusinessCreation } from "./screens/BusinessCreation.tsx";
import { EntrepreneurDashboard } from "./screens/EntrepreneurDashboard.tsx";
import { Marketplace } from "./screens/Marketplace.tsx";
import { Waterfall } from "./screens/Waterfall.tsx";
import { ReferralImpactScreen } from "./screens/ReferralImpact.tsx";
import { LenderDashboard } from "./screens/LenderDashboard.tsx";
import { InsuranceDashboard } from "./screens/InsuranceDashboard.tsx";
import { FreightPartnerDashboard } from "./screens/FreightPartnerDashboard.tsx";
import { ServicesEcosystem } from "./screens/ServicesEcosystem.tsx";
import { CapitalCoordination } from "./screens/CapitalCoordination.tsx";
import { VehicleAssignment } from "./screens/VehicleAssignment.tsx";
import { Ecosystem } from "./screens/Ecosystem.tsx";
import { usePresentation } from "./presentation/presentation.tsx";
import { PresentationWelcome } from "./presentation/PresentationWelcome.tsx";
import { PresentationWhy } from "./presentation/PresentationWhy.tsx";
import { PresentationControls } from "./presentation/PresentationControls.tsx";

function Header() {
  const loc = useLocation();
  const is = (prefix: string) => loc.pathname === prefix || (prefix !== "/" && loc.pathname.startsWith(prefix));
  const linkCls = (active: boolean) =>
    "px-3 py-1.5 rounded-lg text-sm " + (active ? "bg-brand-tint text-brand font-semibold" : "text-ink-soft hover:bg-canvas");
  return (
    <header className="border-b border-canvas-line bg-canvas-panel sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <span className="h-8 w-8 rounded-lg bg-brand text-white grid place-items-center font-display font-semibold">D</span>
          <span className="font-display text-lg font-semibold text-ink hidden sm:block">Drive Society USA</span>
        </Link>
        <nav className="flex items-center gap-0.5 overflow-x-auto">
          <span className="eyebrow hidden md:block pl-1 pr-2">Journey</span>
          <Link to="/" className={linkCls(is("/") || is("/partner"))}>Referral</Link>
          <Link to="/entrepreneur/maria" className={linkCls(is("/entrepreneur") || is("/marketplace") || is("/waterfall"))}>Entrepreneur</Link>
          <span className="w-px h-5 bg-canvas-line mx-1.5" />
          <span className="eyebrow hidden md:block pl-1 pr-2">Ecosystem</span>
          <Link to="/impact/defy" className={linkCls(is("/impact"))}>Referral impact</Link>
          <Link to="/lender" className={linkCls(is("/lender"))}>Lender</Link>
          <Link to="/insurance" className={linkCls(is("/insurance"))}>Insurance</Link>
          <Link to="/freight" className={linkCls(is("/freight"))}>Freight</Link>
          <Link to="/services" className={linkCls(is("/services"))}>Services</Link>
          <Link to="/ecosystem" className={linkCls(is("/ecosystem"))}>The Ecosystem</Link>
          <span className="w-px h-5 bg-canvas-line mx-1.5" />
          <Link to="/present/welcome" className="px-3 py-1.5 rounded-lg text-sm bg-ink text-white hover:bg-ink-soft font-semibold">
            ▶ Presentation
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  const { active } = usePresentation();
  return (
    <div className="min-h-screen flex flex-col">
      {!active && <Header />}
      <main className={"flex-1 max-w-6xl w-full mx-auto px-6 py-8 " + (active ? "pb-28" : "")}>
        <Routes>
          {/* Presentation framing screens (navigation layer only — no business logic) */}
          <Route path="/present/welcome" element={<PresentationWelcome />} />
          <Route path="/present/why" element={<PresentationWhy />} />

          <Route path="/" element={<ReferralDashboard />} />
          <Route path="/partner/:partnerId" element={<ReferralDashboard />} />
          <Route path="/apply/:entrepreneurId" element={<Application />} />
          <Route path="/qualify/:entrepreneurId" element={<Qualification />} />
          <Route path="/business/:entrepreneurId" element={<BusinessCreation />} />
          <Route path="/entrepreneur/:entrepreneurId" element={<EntrepreneurDashboard />} />
          <Route path="/marketplace/:entrepreneurId" element={<Marketplace />} />
          <Route path="/waterfall/:entrepreneurId/:loadId" element={<Waterfall />} />
          {/* Capital + vehicle (entrepreneur journey, partner-coordinated) */}
          <Route path="/capital/:entrepreneurId" element={<CapitalCoordination />} />
          <Route path="/vehicle/:entrepreneurId" element={<VehicleAssignment />} />
          {/* Ecosystem stakeholder dashboards */}
          <Route path="/impact/:partnerId" element={<ReferralImpactScreen />} />
          <Route path="/impact" element={<ReferralImpactScreen />} />
          <Route path="/lender" element={<LenderDashboard />} />
          <Route path="/insurance" element={<InsuranceDashboard />} />
          <Route path="/freight" element={<FreightPartnerDashboard />} />
          <Route path="/services" element={<ServicesEcosystem />} />
          <Route path="/ecosystem" element={<Ecosystem />} />
        </Routes>
      </main>
      {!active && (
        <footer className="border-t border-canvas-line py-4">
          <div className="max-w-6xl mx-auto px-6 text-xs text-ink-muted">
            DSUSA platform demonstration · data shown is representative
          </div>
        </footer>
      )}
      {active && <PresentationControls />}
    </div>
  );
}
