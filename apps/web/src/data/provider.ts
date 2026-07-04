/**
 * provider.ts — the DataProvider interface.
 *
 * THE ARCHITECTURAL KEYSTONE. Every screen reads through this interface and nothing else. Today a
 * MockDataProvider implements it (no backend needed). Later a LiveDataProvider implements the SAME
 * interface over Supabase + the platform contracts/edges — and NO screen changes.
 *
 * Methods are async on purpose: the mock returns resolved promises now; live returns real network
 * calls later. The UI already awaits, so swapping is invisible.
 */
import type {
  ApplicationDraft,
  BusinessPlan,
  Entrepreneur,
  EntrepreneurDashboard,
  FreightLoad,
  FundingStatus,
  PaymentWaterfall,
  ReferralPartner,
  ServicePartner,
  VehicleAssignment,
  ReferralImpact,
  LenderDashboardData,
  InsuranceDashboardData,
  FreightPartnerDashboardData,
  ServiceEcosystemEntry,
  BusinessContinuityStatus,
  BusinessContinuityCapability,
} from "./domain.ts";

export interface DataProvider {
  // --- Referral partner (Step 1, 11) ---
  listReferralPartners(): Promise<readonly ReferralPartner[]>;
  getReferralPartner(id: string): Promise<ReferralPartner | null>;
  listEntrepreneursForPartner(partnerId: string): Promise<readonly Entrepreneur[]>;
  /** Submit a new applicant into DSUSA. Returns the created entrepreneur in "applying" stage. */
  submitApplicant(partnerId: string, draft: ApplicationDraft): Promise<Entrepreneur>;

  // --- Application + qualification (Steps 2, 3) ---
  getEntrepreneur(id: string): Promise<Entrepreneur | null>;
  /** Run qualification (mock: deterministic; live: Qualification Agent). Advances stage. */
  runQualification(entrepreneurId: string): Promise<Entrepreneur>;

  // --- Business creation (Step 4) ---
  /** DSUSA generates the plan; the applicant never authors it. */
  generateBusinessPlan(entrepreneurId: string): Promise<BusinessPlan>;
  getBusinessPlan(entrepreneurId: string): Promise<BusinessPlan | null>;

  // --- Freight marketplace (Step 8) ---
  listLoads(): Promise<readonly FreightLoad[]>;
  acceptLoad(entrepreneurId: string, loadId: string): Promise<FreightLoad>;
  advanceLoad(loadId: string): Promise<FreightLoad>;

  // --- Payment waterfall (Step 9) ---
  getWaterfall(loadId: string): Promise<PaymentWaterfall>;

  // --- Services / capital / vehicle (Steps 5, 6, 7) ---
  listServicePartners(): Promise<readonly ServicePartner[]>;
  getFunding(entrepreneurId: string): Promise<FundingStatus | null>;
  advanceFunding(entrepreneurId: string): Promise<FundingStatus>;
  getVehicle(entrepreneurId: string): Promise<VehicleAssignment | null>;
  advanceVehicle(entrepreneurId: string): Promise<VehicleAssignment>;

  // --- Dashboard rollup (Step 10) ---
  getDashboard(entrepreneurId: string): Promise<EntrepreneurDashboard>;

  // --- Ecosystem stakeholder dashboards (Priority 3) ---
  getReferralImpact(partnerId: string): Promise<ReferralImpact>;
  getLenderDashboard(): Promise<LenderDashboardData>;
  getInsuranceDashboard(): Promise<InsuranceDashboardData>;
  getFreightPartnerDashboard(): Promise<FreightPartnerDashboardData>;
  listServiceEcosystem(): Promise<readonly ServiceEcosystemEntry[]>;

  // --- Business Continuity (platform capability) ---
  getContinuityStatus(entrepreneurId: string): Promise<BusinessContinuityStatus>;
  getContinuityCapability(): Promise<BusinessContinuityCapability>;
}
