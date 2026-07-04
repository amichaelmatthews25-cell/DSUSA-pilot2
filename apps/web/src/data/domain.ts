/**
 * domain.ts — the entrepreneur-journey types the UI renders.
 *
 * These are FRONTEND view types. They mirror the platform's vocabulary (operators, qualification,
 * business classes, loads, payment waterfall) but are shaped for presentation. The data-provider layer
 * maps either mock data OR live platform/Supabase responses into these — so the UI never changes when
 * the source swaps.
 */

export type JourneyStage =
  | "referred"
  | "applying"
  | "qualifying"
  | "qualified"
  | "business_created"
  | "vehicle_assigned"
  | "operating";

export const JOURNEY_STAGES: readonly JourneyStage[] = [
  "referred", "applying", "qualifying", "qualified", "business_created", "vehicle_assigned", "operating",
];

export const STAGE_LABEL: Record<JourneyStage, string> = {
  referred: "Referred",
  applying: "Application",
  qualifying: "Qualification",
  qualified: "Qualified",
  business_created: "Business created",
  vehicle_assigned: "Vehicle assigned",
  operating: "Operating",
};

/** A referral partner organization (Defy Ventures, Fortune Society, ...). */
export interface ReferralPartner {
  readonly id: string;
  readonly name: string;
  readonly kind: string; // e.g. "Reentry services", "Workforce development"
  readonly submittedCount: number;
  readonly operatingCount: number;
}

/** Business class the qualification assigns. */
export type BusinessClassCode = "cargo_van" | "box_truck";
export interface BusinessClass {
  readonly code: BusinessClassCode | string;
  readonly label: string;
  readonly description: string;
}

export type QualificationResult = "pending" | "approved" | "review" | "declined";

/** An entrepreneur (operator) moving through the journey. */
export interface Entrepreneur {
  readonly id: string;
  readonly name: string;
  readonly referralPartnerId: string;
  readonly stage: JourneyStage;
  readonly appliedAt: string;
  readonly qualification: QualificationResult;
  readonly businessClass: BusinessClass | null;
}

/** Application intake (Step 2). */
export interface ApplicationDraft {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly hasExistingEntity: boolean;
  readonly entityType: "sole_proprietor" | "llc" | "existing";
  readonly documentsProvided: readonly string[];
}

/** Auto-generated business plan (Step 4) — DSUSA generates, applicant does not. */
export interface BusinessPlan {
  readonly profile: { readonly legalName: string; readonly entityType: string; readonly businessClass: string };
  readonly startupBudget: readonly { readonly item: string; readonly amount: number }[];
  readonly revenueModel: readonly { readonly stream: string; readonly monthly: number }[];
  readonly capitalRequirement: number;
  readonly operatingPlan: readonly string[];
  readonly kpis: readonly { readonly name: string; readonly target: string }[];
}

/** A freight load (Step 8, mock marketplace). */
export type LoadStatus = "available" | "assigned" | "in_transit" | "delivered" | "payment_pending" | "completed";
export interface FreightLoad {
  readonly id: string;
  readonly pickup: string;
  readonly delivery: string;
  readonly revenue: number;
  readonly vehicleType: string;
  readonly distanceMi: number;
  readonly status: LoadStatus;
  /** The ecosystem partner offering this opportunity. DSUSA coordinates — it does not broker. */
  readonly sourcePartner: string;
  /** Whether the load matches the entrepreneur's assigned vehicle class. */
  readonly compatible: boolean;
  /** Estimated net to the entrepreneur after the waterfall (shown up front). */
  readonly estimatedNet: number;
}

/** Payment waterfall (Step 9). */
export interface WaterfallLeg {
  readonly party: string;
  readonly amount: number;
  readonly kind: "gross" | "deduction" | "net";
}
export interface PaymentWaterfall {
  readonly loadId: string;
  readonly customerPayment: number;
  readonly legs: readonly WaterfallLeg[];
  readonly entrepreneurNet: number;
}

/** A professional-services partner (Step 5, mock). */
export interface ServicePartner {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly status: "available" | "connected" | "recommended";
}

/** Capital coordination (Step 6). */
export type FundingStage = "requested" | "submitted" | "under_review" | "approved" | "complete";
export interface FundingStatus {
  readonly entrepreneurId: string;
  readonly stage: FundingStage;
  readonly amount: number;
  readonly lender: string;
}

/** Vehicle assignment (Step 7). */
export type VehicleStage = "matching" | "available" | "assigned" | "insured" | "ready";
export interface VehicleAssignment {
  readonly entrepreneurId: string;
  readonly businessClass: string;
  readonly vehicle: string;
  readonly stage: VehicleStage;
}

/** Entrepreneur dashboard rollup (Step 10). */
export interface EntrepreneurDashboard {
  readonly entrepreneur: Entrepreneur;
  readonly businessPlan: BusinessPlan | null;
  readonly revenueToDate: number;
  readonly completedLoads: number;
  readonly businessHealth: "starting" | "healthy" | "watch";
  readonly funding: FundingStatus | null;
  readonly vehicle: VehicleAssignment | null;
}

// ============================================================================
// Ecosystem stakeholder dashboards (Priority 3). Each answers: what value, what
// opportunities, how DSUSA makes the job easier.
// ============================================================================

/** Referral partner impact rollup. */
export interface ReferralImpact {
  readonly partnerName: string;
  readonly referred: number;
  readonly qualified: number;
  readonly businessesCreated: number;
  readonly operating: number;
  readonly communityRevenue: number;
  readonly successRate: number;
  readonly economicImpact: number;
}

/** Lender portfolio view. */
export interface LenderDashboardData {
  readonly applications: number;
  readonly funded: number;
  readonly outstandingPortfolio: number;
  readonly portfolioHealth: "strong" | "stable" | "watch";
  readonly onTimePaymentRate: number;
  readonly waterfallSettlements: readonly { readonly loadId: string; readonly toLender: number; readonly date: string }[];
  readonly interventions: readonly { readonly business: string; readonly action: string }[];
}

/** Insurance partner view. */
export interface InsuranceDashboardData {
  readonly insured: number;
  readonly activePolicies: number;
  readonly renewalsDue: number;
  readonly premiumVolume: number;
  readonly newOpportunities: readonly { readonly business: string; readonly product: string }[];
}

/** Freight partner view. */
export interface FreightPartnerDashboardData {
  readonly businessesAvailable: number;
  readonly capacityVehicles: number;
  readonly loadsPosted: number;
  readonly loadsAccepted: number;
  readonly completionRate: number;
  readonly avgDeliveryPerformance: number;
}

/** A service-provider ecosystem entry (richer than the directory pill). */
export interface ServiceEcosystemEntry {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly provides: string;
  readonly whyNeeded: string;
  readonly integration: string;
  readonly status: "available" | "connected" | "recommended";
}

// ============================================================================
// Business Continuity — a core platform capability (not a single feature).
//
// DSUSA is business infrastructure: it helps businesses BEGIN operating and helps them
// REMAIN productive when disruptions occur. Business Continuity is the capability that
// coordinates operational oversight and structured responses. Future workflows
// (operator transitions, vehicle reassignment, intervention plans, support escalations)
// extend this capability via the BusinessContinuityResponse "kind" union without changing
// the core shape.
//
// Language discipline: this models support that is *designed to* / *intended to* coordinate
// responses, subject to legal, contractual, and operational requirements. It never asserts
// guaranteed repayment, recovery, reassignment, or outcomes.
// ============================================================================

export type ContinuityOperationalStatus = "operating" | "monitoring" | "intervention" | "transition";
export type ContinuitySupportLevel = "standard" | "elevated" | "active";
export type ContinuityInterventionStatus = "none" | "watch" | "in_progress";

/**
 * A coordinated response type under Business Continuity. The union is open by design:
 * future modules add new kinds (operator_transition, support_escalation, ...) without
 * changing consumers that treat responses generically.
 */
export type ContinuityResponseKind =
  | "operational_oversight"
  | "vehicle_reassignment"
  | "intervention_plan"
  | "operator_transition"
  | "support_escalation";

export interface ContinuityResponse {
  readonly kind: ContinuityResponseKind;
  readonly label: string;
  readonly description: string;
  /** Whether this response type is available/configured in the current ecosystem. */
  readonly available: boolean;
}

/** Per-entrepreneur Business Continuity standing, shown on the entrepreneur dashboard. */
export interface BusinessContinuityStatus {
  readonly entrepreneurId: string;
  readonly businessHealth: "healthy" | "watch" | "at_risk";
  readonly operationalStatus: ContinuityOperationalStatus;
  readonly supportLevel: ContinuitySupportLevel;
  readonly interventionStatus: ContinuityInterventionStatus;
  /** Present only when a recovery plan is applicable. */
  readonly recoveryPlan: string | null;
  readonly currentStanding: string;
}

/** Platform-level Business Continuity capability summary (for partner/value views). */
export interface BusinessContinuityCapability {
  readonly monitoredBusinesses: number;
  readonly operatingNormally: number;
  readonly underMonitoring: number;
  readonly activeInterventions: number;
  /** The coordinated response types this capability can orchestrate. */
  readonly responses: readonly ContinuityResponse[];
}
