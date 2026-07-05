/**
 * mock.ts — MockDataProvider. Implements DataProvider with realistic, stateful in-memory data.
 *
 * This tells Maria Rodriguez's story (referred by Defy Ventures). State mutates as the demo advances
 * (submit -> qualify -> business -> operating), so the walkthrough is continuous, not a set of static
 * screens. Swappable for a LiveDataProvider later with zero UI changes.
 */
import type { DataProvider } from "./provider.ts";
import type {
  ApplicationDraft, BusinessPlan, Entrepreneur, EntrepreneurDashboard, FreightLoad,
  FundingStatus, PaymentWaterfall, ReferralPartner, ServicePartner, VehicleAssignment,
  ReferralImpact, LenderDashboardData, InsuranceDashboardData, FreightPartnerDashboardData,
  ServiceEcosystemEntry, BusinessContinuityStatus, BusinessContinuityCapability,
} from "./domain.ts";

let idSeq = 100;
const nextId = (p: string): string => `${p}-${++idSeq}`;

const PARTNERS: ReferralPartner[] = [
  { id: "defy", name: "Defy Ventures", kind: "Entrepreneurship & reentry", submittedCount: 18, operatingCount: 11 },
  { id: "fortune", name: "The Fortune Society", kind: "Reentry services", submittedCount: 24, operatingCount: 14 },
  { id: "exodus", name: "Exodus Transitional Community", kind: "Reentry & workforce", submittedCount: 9, operatingCount: 5 },
  { id: "housingworks", name: "Housing Works", kind: "Housing & employment", submittedCount: 7, operatingCount: 3 },
  { id: "brooklynrrc", name: "Brooklyn RRC", kind: "Residential reentry", submittedCount: 6, operatingCount: 2 },
];

/** Maria — the protagonist. Begins as a not-yet-submitted prospect at Defy Ventures. */
function makeMaria(): Entrepreneur {
  return {
    id: "maria",
    name: "Maria Rodriguez",
    referralPartnerId: "defy",
    stage: "referred",
    appliedAt: new Date().toISOString(),
    qualification: "pending",
    businessClass: null,
  };
}

const CARGO_VAN = {
  code: "cargo_van",
  label: "Cargo Van",
  description: "Last-mile and regional delivery in a Ford Transit-class cargo van.",
};

export class MockDataProvider implements DataProvider {
  private partners = PARTNERS.map((p) => ({ ...p }));
  private entrepreneurs = new Map<string, Entrepreneur>();
  private plans = new Map<string, BusinessPlan>();
  private loads: FreightLoad[] = seedLoads();
  private funding = new Map<string, FundingStatus>();
  private vehicles = new Map<string, VehicleAssignment>();
  private acceptedLoadByEntrepreneur = new Map<string, string>();

  constructor() {
    // Seed Maria + a few prior operating entrepreneurs so partner dashboards look alive.
    this.entrepreneurs.set("maria", makeMaria());
    for (const seed of seedPriorEntrepreneurs()) this.entrepreneurs.set(seed.id, seed);
  }

  async listReferralPartners(): Promise<readonly ReferralPartner[]> {
    return this.partners.map((p) => ({ ...p }));
  }
  async getReferralPartner(id: string): Promise<ReferralPartner | null> {
    return this.partners.find((p) => p.id === id) ?? null;
  }
  async listEntrepreneursForPartner(partnerId: string): Promise<readonly Entrepreneur[]> {
    return [...this.entrepreneurs.values()].filter((e) => e.referralPartnerId === partnerId);
  }

  async submitApplicant(partnerId: string, draft: ApplicationDraft): Promise<Entrepreneur> {
    // If this is Maria's known story, advance her; otherwise create a new entrepreneur.
    const existing = [...this.entrepreneurs.values()].find(
      (e) => e.referralPartnerId === partnerId && e.name === draft.fullName,
    );
    const entrepreneur: Entrepreneur = existing
      ? { ...existing, stage: "applying", appliedAt: new Date().toISOString() }
      : {
          id: nextId("ent"),
          name: draft.fullName,
          referralPartnerId: partnerId,
          stage: "applying",
          appliedAt: new Date().toISOString(),
          qualification: "pending",
          businessClass: null,
        };
    this.entrepreneurs.set(entrepreneur.id, entrepreneur);
    const partner = this.partners.find((p) => p.id === partnerId);
    if (partner && !existing) partner.submittedCount += 1;
    return entrepreneur;
  }

  async getEntrepreneur(id: string): Promise<Entrepreneur | null> {
    return this.entrepreneurs.get(id) ?? null;
  }

  async runQualification(entrepreneurId: string): Promise<Entrepreneur> {
    const e = this.entrepreneurs.get(entrepreneurId);
    if (!e) throw new Error(`unknown entrepreneur ${entrepreneurId}`);
    // Deterministic, realistic: approve into Cargo Van class. (Live: Qualification Agent decides.)
    const updated: Entrepreneur = {
      ...e, stage: "qualified", qualification: "approved", businessClass: CARGO_VAN,
    };
    this.entrepreneurs.set(updated.id, updated);
    return updated;
  }

  async generateBusinessPlan(entrepreneurId: string): Promise<BusinessPlan> {
    const e = this.entrepreneurs.get(entrepreneurId);
    if (!e) throw new Error(`unknown entrepreneur ${entrepreneurId}`);
    const plan = buildPlan(e.name);
    this.plans.set(entrepreneurId, plan);
    // Generating the plan creates the business + sets up funding & vehicle pipelines.
    this.entrepreneurs.set(entrepreneurId, { ...e, stage: "business_created" });
    this.funding.set(entrepreneurId, {
      entrepreneurId, stage: "submitted", amount: plan.capitalRequirement, lender: "DSUSA Capital Partner",
    });
    this.vehicles.set(entrepreneurId, {
      entrepreneurId, businessClass: "Cargo Van", vehicle: "2024 Ford Transit 250", stage: "matching",
    });
    return plan;
  }
  async getBusinessPlan(entrepreneurId: string): Promise<BusinessPlan | null> {
    return this.plans.get(entrepreneurId) ?? null;
  }

  async listLoads(): Promise<readonly FreightLoad[]> {
    return this.loads.map((l) => ({ ...l }));
  }
  async acceptLoad(entrepreneurId: string, loadId: string): Promise<FreightLoad> {
    const idx = this.loads.findIndex((l) => l.id === loadId);
    if (idx === -1) throw new Error(`unknown load ${loadId}`);
    this.loads[idx] = { ...this.loads[idx]!, status: "assigned" };
    this.acceptedLoadByEntrepreneur.set(entrepreneurId, loadId);
    return { ...this.loads[idx]! };
  }
  async advanceLoad(loadId: string): Promise<FreightLoad> {
    const idx = this.loads.findIndex((l) => l.id === loadId);
    if (idx === -1) throw new Error(`unknown load ${loadId}`);
    const flow: FreightLoad["status"][] = ["available", "assigned", "in_transit", "delivered", "payment_pending", "completed"];
    const i = flow.indexOf(this.loads[idx]!.status);
    this.loads[idx] = { ...this.loads[idx]!, status: flow[Math.min(i + 1, flow.length - 1)]! };
    return { ...this.loads[idx]! };
  }

  async getWaterfall(loadId: string): Promise<PaymentWaterfall> {
    const load = this.loads.find((l) => l.id === loadId) ?? this.loads[0]!;
    return buildWaterfall(load);
  }

  async listServicePartners(): Promise<readonly ServicePartner[]> {
    return SERVICE_PARTNERS.map((s) => ({ ...s }));
  }

  async getFunding(entrepreneurId: string): Promise<FundingStatus | null> {
    return this.funding.get(entrepreneurId) ?? null;
  }
  async advanceFunding(entrepreneurId: string): Promise<FundingStatus> {
    const f = this.funding.get(entrepreneurId);
    if (!f) throw new Error(`no funding for ${entrepreneurId}`);
    const flow: FundingStatus["stage"][] = ["requested", "submitted", "under_review", "approved", "complete"];
    const i = flow.indexOf(f.stage);
    const updated = { ...f, stage: flow[Math.min(i + 1, flow.length - 1)]! };
    this.funding.set(entrepreneurId, updated);
    return updated;
  }

  async getVehicle(entrepreneurId: string): Promise<VehicleAssignment | null> {
    return this.vehicles.get(entrepreneurId) ?? null;
  }
  async advanceVehicle(entrepreneurId: string): Promise<VehicleAssignment> {
    const v = this.vehicles.get(entrepreneurId);
    if (!v) throw new Error(`no vehicle for ${entrepreneurId}`);
    const flow: VehicleAssignment["stage"][] = ["matching", "available", "assigned", "insured", "ready"];
    const i = flow.indexOf(v.stage);
    const updated = { ...v, stage: flow[Math.min(i + 1, flow.length - 1)]! };
    this.vehicles.set(entrepreneurId, updated);
    if (updated.stage === "ready") {
      const e = this.entrepreneurs.get(entrepreneurId);
      if (e) this.entrepreneurs.set(entrepreneurId, { ...e, stage: "operating" });
    }
    return updated;
  }

  async getDashboard(entrepreneurId: string): Promise<EntrepreneurDashboard> {
    const e = this.entrepreneurs.get(entrepreneurId);
    if (!e) throw new Error(`unknown entrepreneur ${entrepreneurId}`);
    const businessPlan = this.plans.get(entrepreneurId) ?? null;
    const operating = e.stage === "operating" || e.stage === "business_created" || e.stage === "vehicle_assigned";
    return {
      entrepreneur: e,
      businessPlan,
      revenueToDate: operating ? 14820 : 0,
      completedLoads: operating ? 9 : 0,
      businessHealth: operating ? "healthy" : "starting",
      funding: this.funding.get(entrepreneurId) ?? null,
      vehicle: this.vehicles.get(entrepreneurId) ?? null,
    };
  }

  // --- Ecosystem stakeholder dashboards ---

  async getReferralImpact(partnerId: string): Promise<ReferralImpact> {
    const p = this.partners.find((x) => x.id === partnerId) ?? this.partners[0]!;
    const referred = p.submittedCount;
    const qualified = Math.round(referred * 0.83);
    const created = Math.round(referred * 0.72);
    const operating = p.operatingCount;
    // Community revenue: operating businesses × representative annualized revenue.
    const communityRevenue = operating * 96000;
    return {
      partnerName: p.name,
      referred,
      qualified,
      businessesCreated: created,
      operating,
      communityRevenue,
      successRate: Math.round((operating / referred) * 100),
      // Economic impact: revenue + downstream (wages, taxes, local spend) at ~1.6x.
      economicImpact: Math.round(communityRevenue * 1.6),
    };
  }

  async getLenderDashboard(): Promise<LenderDashboardData> {
    return {
      applications: 64,
      funded: 41,
      outstandingPortfolio: 41 * 11350 - 78000,
      portfolioHealth: "strong",
      onTimePaymentRate: 97,
      waterfallSettlements: [
        { loadId: "L-2980", toLender: 110, date: "Today" },
        { loadId: "L-2974", toLender: 176, date: "Today" },
        { loadId: "L-2969", toLender: 95, date: "Yesterday" },
        { loadId: "L-2961", toLender: 212, date: "Yesterday" },
      ],
      interventions: [
        { business: "Ortega Hauling LLC", action: "Payment auto-recovered from next 2 loads" },
        { business: "Greene Freight LLC", action: "Fuel cost flagged; dispatch re-routed" },
      ],
    };
  }

  async getInsuranceDashboard(): Promise<InsuranceDashboardData> {
    return {
      insured: 38,
      activePolicies: 41,
      renewalsDue: 6,
      premiumVolume: 41 * 3200 * 4,
      newOpportunities: [
        { business: "Rodriguez Logistics LLC", product: "Commercial auto + cargo" },
        { business: "New referrals this week (3)", product: "Commercial auto" },
        { business: "Carter Transport LLC", product: "Add cargo coverage" },
      ],
    };
  }

  async getFreightPartnerDashboard(): Promise<FreightPartnerDashboardData> {
    return {
      businessesAvailable: 41,
      capacityVehicles: 41,
      loadsPosted: 312,
      loadsAccepted: 287,
      completionRate: 98,
      avgDeliveryPerformance: 97,
    };
  }

  async listServiceEcosystem(): Promise<readonly ServiceEcosystemEntry[]> {
    return SERVICE_ECOSYSTEM.map((s) => ({ ...s }));
  }

  // --- Business Continuity (platform capability) ---

  async getContinuityStatus(entrepreneurId: string): Promise<BusinessContinuityStatus> {
    const e = this.entrepreneurs.get(entrepreneurId);
    if (!e) throw new Error(`unknown entrepreneur ${entrepreneurId}`);
    // Maria (and healthy operators) display Healthy / no intervention required.
    return {
      entrepreneurId,
      businessHealth: "healthy",
      operationalStatus: "operating",
      supportLevel: "standard",
      interventionStatus: "none",
      recoveryPlan: null,
      currentStanding: "In good standing — operating normally.",
    };
  }

  async getContinuityCapability(): Promise<BusinessContinuityCapability> {
    return {
      monitoredBusinesses: 41,
      operatingNormally: 38,
      underMonitoring: 2,
      activeInterventions: 1,
      responses: [
        { kind: "operational_oversight", label: "Operational oversight", description: "Ongoing visibility into business health and operating activity after funding.", available: true },
        { kind: "intervention_plan", label: "Structured intervention", description: "Coordinated, standardized workflows designed to address disruptions early.", available: true },
        { kind: "vehicle_reassignment", label: "Vehicle reassignment", description: "One possible operational response when a financed asset stops generating revenue.", available: true },
        { kind: "operator_transition", label: "Operator transition", description: "Coordinated support intended to keep a productive business operating if an operator exits.", available: true },
        { kind: "support_escalation", label: "Support escalation", description: "Escalation paths to ecosystem partners when a business needs additional support.", available: true },
      ],
    };
  }
}

// --- seed builders ---

function buildPlan(name: string): BusinessPlan {
  const legalName = `${name.split(" ")[0]} Rodriguez Logistics LLC`;
  return {
    profile: { legalName, entityType: "Sole Proprietor (default)", businessClass: "Cargo Van" },
    startupBudget: [
      { item: "Vehicle down payment", amount: 4500 },
      { item: "Commercial insurance (first quarter)", amount: 2700 },
      { item: "Registration, permits & compliance", amount: 950 },
      { item: "Initial fuel & maintenance reserve", amount: 1200 },
      { item: "Working capital", amount: 2000 },
    ],
    revenueModel: [
      { stream: "Regional delivery contracts", monthly: 6200 },
      { stream: "Last-mile spot loads", monthly: 2400 },
    ],
    capitalRequirement: 11350,
    operatingPlan: [
      "Operate a Ford Transit-class cargo van on regional and last-mile routes.",
      "Source loads through the DSUSA freight marketplace.",
      "Payments routed automatically through the DSUSA payment waterfall.",
      "Insurance, fuel, and compliance coordinated by DSUSA service partners.",
    ],
    kpis: [
      { name: "Monthly revenue", target: "$8,600" },
      { name: "On-time delivery", target: "≥ 97%" },
      { name: "Net margin", target: "≥ 28%" },
      { name: "Loads / week", target: "10–14" },
    ],
  };
}

function buildWaterfall(load: FreightLoad): PaymentWaterfall {
  const gross = load.revenue;
  const lender = Math.round(gross * 0.18);
  const insurance = Math.round(gross * 0.08);
  const warranty = Math.round(gross * 0.03);
  const fuel = Math.round(gross * 0.14);
  const platform = Math.round(gross * 0.05);
  const net = gross - lender - insurance - warranty - fuel - platform;
  return {
    loadId: load.id,
    customerPayment: gross,
    legs: [
      { party: "Customer payment", amount: gross, kind: "gross" },
      { party: "DSUSA platform", amount: platform, kind: "deduction" },
      { party: "Lender", amount: lender, kind: "deduction" },
      { party: "Insurance", amount: insurance, kind: "deduction" },
      { party: "Warranty", amount: warranty, kind: "deduction" },
      { party: "Fuel program", amount: fuel, kind: "deduction" },
      { party: "Entrepreneur (Maria)", amount: net, kind: "net" },
    ],
    entrepreneurNet: net,
  };
}

function seedLoads(): FreightLoad[] {
  // DSUSA coordinates opportunities sourced from ecosystem partners (brokers/shippers) — it is not the broker.
  const mk = (id: string, pickup: string, delivery: string, revenue: number, vehicleType: string, distanceMi: number, sourcePartner: string): FreightLoad => ({
    id, pickup, delivery, revenue, vehicleType, distanceMi, status: "available", sourcePartner,
    compatible: vehicleType === "Cargo Van",
    estimatedNet: estimateNet(revenue),
  });
  return [
    mk("L-3001", "Newark, NJ", "Philadelphia, PA", 720, "Cargo Van", 95, "Eastern Freight Exchange"),
    mk("L-3002", "Brooklyn, NY", "Boston, MA", 1180, "Cargo Van", 215, "Eastern Freight Exchange"),
    mk("L-3003", "Queens, NY", "Hartford, CT", 640, "Cargo Van", 118, "Metro Shippers Co-op"),
    mk("L-3004", "Jersey City, NJ", "Baltimore, MD", 980, "Box Truck", 185, "Atlantic Logistics Partners"),
    mk("L-3005", "Bronx, NY", "Albany, NY", 700, "Cargo Van", 150, "Metro Shippers Co-op"),
  ];
}

/** Estimated entrepreneur net after the coordinated waterfall (same proportions as buildWaterfall). */
function estimateNet(gross: number): number {
  const lender = Math.round(gross * 0.18);
  const insurance = Math.round(gross * 0.08);
  const warranty = Math.round(gross * 0.03);
  const fuel = Math.round(gross * 0.14);
  const platform = Math.round(gross * 0.05);
  return gross - lender - insurance - warranty - fuel - platform;
}

function seedPriorEntrepreneurs(): Entrepreneur[] {
  return [
    { id: "ent-james", name: "James Carter", referralPartnerId: "defy", stage: "operating", appliedAt: "2025-09-01T00:00:00Z", qualification: "approved", businessClass: CARGO_VAN },
    { id: "ent-tasha", name: "Tasha Greene", referralPartnerId: "defy", stage: "operating", appliedAt: "2025-10-12T00:00:00Z", qualification: "approved", businessClass: { code: "box_truck", label: "Box Truck", description: "Mid-size freight." } },
    { id: "ent-luis", name: "Luis Ortega", referralPartnerId: "defy", stage: "qualifying", appliedAt: "2026-01-05T00:00:00Z", qualification: "pending", businessClass: null },
  ];
}

const SERVICE_PARTNERS: ServicePartner[] = [
  { id: "sp-ins", category: "Commercial Insurance", name: "Atlas Commercial Coverage", status: "connected" },
  { id: "sp-war", category: "Warranty Providers", name: "DriveGuard Warranty", status: "available" },
  { id: "sp-lender", category: "Lenders", name: "DSUSA Capital Partner", status: "connected" },
  { id: "sp-fuel", category: "Fuel Programs", name: "FleetFuel Network", status: "connected" },
  { id: "sp-dispatch", category: "Dispatch", name: "RouteIQ Dispatch", status: "available" },
  { id: "sp-broker", category: "Freight Brokers", name: "Eastern Freight Exchange", status: "recommended" },
  { id: "sp-acct", category: "Accounting", name: "LedgerLine Bookkeeping", status: "available" },
  { id: "sp-comp", category: "Compliance", name: "DOT Compliance Co.", status: "connected" },
  { id: "sp-bank", category: "Business Banking", name: "Keystone Business Bank", status: "available" },
  { id: "sp-dealer", category: "Vehicle Dealers", name: "Metro Commercial Vehicles", status: "connected" },
  { id: "sp-ben", category: "Benefits", name: "SmallBiz Benefits Group", status: "available" },
];

const SERVICE_ECOSYSTEM: ServiceEcosystemEntry[] = [
  { id: "se-ins", category: "Commercial Insurance", name: "Atlas Commercial Coverage", provides: "Commercial auto, cargo, and liability coverage built for owner-operators.", whyNeeded: "Required to operate legally and protect the business from day one.", integration: "Policies activate automatically at vehicle assignment; premiums settle through the payment waterfall.", status: "connected" },
  { id: "se-lender", category: "Lenders", name: "DSUSA Capital Partner", provides: "Startup capital for vehicle, insurance, and working capital.", whyNeeded: "Entrepreneurs rarely have $11k+ upfront; financing makes ownership possible.", integration: "Funding is coordinated at business creation; repayment auto-deducts per completed job.", status: "connected" },
  { id: "se-fuel", category: "Fuel Programs", name: "FleetFuel Network", provides: "Discounted fleet fuel pricing and a fuel card.", whyNeeded: "Fuel is the largest variable cost; discounts directly protect margin.", integration: "Fuel costs are netted in the waterfall; savings flow straight to the entrepreneur.", status: "connected" },
  { id: "se-dealer", category: "Vehicle Dealers", name: "Metro Commercial Vehicles", provides: "Cargo vans and box trucks matched to the assigned business class.", whyNeeded: "The vehicle is the business; the right one must be ready to operate.", integration: "Inventory matched to qualification result; delivery coordinated with funding + insurance.", status: "connected" },
  { id: "se-broker", category: "Freight Partners", name: "Eastern Freight Exchange", provides: "A steady stream of compatible delivery opportunities.", whyNeeded: "Reliable work is what turns a vehicle into income.", integration: "Loads surface in the marketplace; DSUSA coordinates — it does not broker.", status: "recommended" },
  { id: "se-warr", category: "Warranty Providers", name: "DriveGuard Warranty", provides: "Mechanical breakdown protection for the vehicle.", whyNeeded: "One major repair can end a new business; warranty keeps it running.", integration: "Coverage attaches at vehicle assignment; claims settle through the waterfall.", status: "available" },
  { id: "se-dispatch", category: "Dispatch", name: "RouteIQ Dispatch", provides: "Route optimization and load scheduling.", whyNeeded: "Better routing means more completed loads and lower fuel cost.", integration: "Optional add-on; integrates with accepted opportunities.", status: "available" },
  { id: "se-acct", category: "Accounting", name: "LedgerLine Bookkeeping", provides: "Bookkeeping, tax prep, and quarterly filings.", whyNeeded: "Keeps the business compliant and the owner focused on driving.", integration: "Auto-syncs settled payments from the waterfall as clean books.", status: "available" },
  { id: "se-comp", category: "Compliance", name: "DOT Compliance Co.", provides: "DOT registration, permits, and ongoing compliance.", whyNeeded: "Operating legally is non-negotiable for commercial transport.", integration: "Compliance status tracked on the dashboard; renewals coordinated.", status: "connected" },
  { id: "se-bank", category: "Business Banking", name: "Keystone Business Bank", provides: "Business checking and a path to credit.", whyNeeded: "Separates business finances and builds the business credit profile.", integration: "Waterfall net deposits land directly in the business account.", status: "available" },
  { id: "se-ben", category: "Benefits", name: "SmallBiz Benefits Group", provides: "Health and retirement options for owner-operators.", whyNeeded: "Helps entrepreneurs build stability, not just income.", integration: "Offered once the business is operating and cash-flow positive.", status: "available" },
];
