// The shapes the LA-3 API returns and the pages render. Client-safe, types only.
// Sensitive values never appear here in plain text: a sensitive field carries `masked` and
// `hasValue`, and the real value comes from a single reveal call.

import type {
  ApplicationOutcome, ApplicationStatus, BeneficiaryRelationship, CaseStatus, IncomeType, InsuredRole,
  OutcomeReasonCode, PaymentMethod, RequirementKind, ValueSource, WaitingOn,
} from "./constants";
import type { BeneficiaryTier } from "./beneficiaries";
import type { QaVerdict } from "./qa";

export type FieldValue = {
  value: string | number | boolean | null;
  source: ValueSource;
  /** A prefilled value the agent has confirmed (QA "prefilled, never reviewed" warning). */
  reviewed: boolean;
  /** Sensitive fields only: `••••1234`, never the value. */
  masked?: string;
  hasValue?: boolean;
  /** Spouse: this value tracks the primary insured's (LA-3.24). */
  linked?: boolean;
};

export type ApplicationListRow = {
  caseId: string;
  applicationId: string;
  leadId: string;
  clientName: string;
  insuredRole: InsuredRole;
  state: string | null;
  carrierName: string | null;
  productLabel: string | null;
  attemptNo: number;
  status: ApplicationStatus;
  outcome: ApplicationOutcome | null;
  monthlyPremiumCents: number | null;
  qaVerdict: QaVerdict["verdict"] | null;
  reference: string | null;
  policyNumber: string | null;
  updatedAt: string;
};

export type QuoteView = {
  id: string;
  carrierId: string;
  carrierName: string;
  productLabel: string;
  tier: string;
  termLength?: number | null;
  healthClass?: string | null;
  faceAmountCents: number;
  monthlyPremiumCents: number;
  annualPremiumCents?: number | null;
  riders: { name: string; monthlyPremiumCents: number }[];
  ageUsed: number | null;
  status: "draft" | "presented" | "selected" | "discarded";
  appointed: { ok: boolean; reason: string | null };
  acceptsPaymentMethod: boolean | null;
  warnings: { code: string; message: string }[];
  payout: { fycCents: number; advanceCents: number; advanceMonths: number; contractLevelBp: number } | null;
  createdAt: string;
};

export type BeneficiaryView = {
  id: string;
  tier: BeneficiaryTier;
  first_name: string;
  last_name: string;
  relationship: BeneficiaryRelationship | "";
  relationship_other?: string;
  dob?: string | null;
  share_bp: number;
  phone?: string | null;
};

export type PaymentView = {
  method: PaymentMethod;
  draftDay: number | null;
  draftDayRecommended: number | null;
  draftOverrideReason: string | null;
  incomeType: IncomeType | null;
  incomeInputs: Record<string, unknown>;
  accountType?: "checking" | "savings" | null;
  bankName?: string | null;
  nameOnAccount?: string | null;
  routing?: { masked: string; hasValue: boolean };
  account?: { masked: string; hasValue: boolean };
  card?: { masked: string; hasValue: boolean; brand: string | null; expMonth: number | null; expYear: number | null };
  nameOnCard?: string | null;
  billingFrequency?: "monthly" | "quarterly" | "semiannual" | "annual" | null;
  linked?: boolean;
  /** Spouse: the draft day follows the primary insured's (LA-3.24). */
  draftDayLinked?: boolean;
};

export type DisclosureView = {
  id: string;
  code: string;
  title: string;
  body: string;
  version: number;
  status: "required" | "acknowledged" | "not_applicable";
  method: "read_aloud" | "emailed" | "mailed" | null;
  note: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
};

export type InterviewQuestion = {
  key: string;
  label: string;
  type: "boolean" | "single_select" | "multi_select" | "number" | "date" | "text" | "long_text" | "medication_list";
  options?: string[];
  required?: boolean;
  section: string;
  knockout?: { when: string | boolean; note: string } | null;
  showWhen?: { key: string; equals: string | boolean } | null;
  help?: string | null;
  /** One of the five "does the policy survive" questions (LA-3.1). */
  persistency?: boolean;
  /** Asked only of an insured this rule fits (LA-3.1 "Applies to"); absent means everyone. */
  appliesTo?: "age_50_plus" | "age_under_50" | "tobacco" | null;
};

export type MedicationRow = {
  id: string;
  name: string;
  dose: string;
  since: string;
  prescribedFor: string;
  prescribedForUnknown: boolean;
  notes?: string;
};

export type InterviewView = {
  id: string;
  templateName: string;
  templateRevision: number;
  startedAt: string;
  completedAt: string | null;
  questions: InterviewQuestion[];
  answers: Record<string, { value: string | boolean | number | string[] | null; notes?: string }>;
  medications: MedicationRow[];
};

export type RequirementView = {
  id: string;
  applicationId: string;
  caseId: string;
  clientName: string;
  carrierName: string | null;
  monthlyPremiumCents: number | null;
  kind: RequirementKind;
  description: string;
  waitingOn: WaitingOn;
  status: "open" | "in_progress" | "satisfied" | "waived" | "expired";
  raisedAt: string;
  dueAt: string | null;
  lastChasedAt: string | null;
  chaseCount: number;
  exam?: { vendor: string | null; orderedOn: string | null; scheduledOn: string | null; completedOn: string | null; resultsOn: string | null } | null;
};

export type CounterofferView = {
  id: string;
  receivedAt: string;
  applied: { tier: string | null; healthClass: string | null; faceCents: number; monthlyCents: number };
  offered: { tier: string | null; healthClass: string | null; faceCents: number; monthlyCents: number };
  reason: string;
  expiresAt: string;
  status: "pending_client" | "accepted" | "rejected" | "expired";
};

export type SubmissionView = {
  id: string;
  attemptNo: number;
  carrierReference: string | null;
  referenceKind: "application_no" | "policy_no" | null;
  policyNumber: string | null;
  submittedAt: string;
  submittedVia: "extension" | "copy_assist" | "carrier_portal_manual";
  hasConfirmation: boolean;
  qaVerdict: QaVerdict["verdict"];
};

export type AttemptView = {
  id: string;
  caseId: string;
  attemptNo: number;
  insuredRole: InsuredRole;
  status: ApplicationStatus;
  outcome: ApplicationOutcome | null;
  outcomeReasonCode: OutcomeReasonCode | null;
  outcomeReasonText: string | null;
  carrierId: string | null;
  carrierName: string | null;
  carrierPortalUrl: string | null;
  portalUsername: string | null;
  productCode: string | null;
  productLabel: string | null;
  tier: string | null;
  selectedQuoteId: string | null;
  values: Record<string, FieldValue>;
  requiredKeys: string[];
  payment: PaymentView | null;
  beneficiaries: BeneficiaryView[];
  disclosures: DisclosureView[];
  quotes: QuoteView[];
  requirements: RequirementView[];
  counteroffers: CounterofferView[];
  submissions: SubmissionView[];
  welcomePack: { status: "not_sent" | "queued" | "sent" | "bounced" | "review"; recipient: string | null; sentAt: string | null } | null;
  appointment: { ok: boolean; reason: string | null };
  /** `band` is the product's own plausible $ per $1,000 (LA-3.25); absent or null means none set. */
  product: { issueAgeMin: number | null; issueAgeMax: number | null; faceMinCents: number | null; faceMaxCents: number | null; acceptedPaymentMethods: PaymentMethod[]; band?: { min: number; max: number } | null } | null;
  submittedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

export type CaseView = {
  caseId: string;
  leadId: string;
  status: CaseStatus;
  source: "inbound" | "outbound" | "manual";
  clientName: string;
  clientState: string | null;
  clientPhone: string | null;
  campaignName: string | null;
  openedAt: string;
  interviews: Partial<Record<InsuredRole, InterviewView>>;
  attempts: AttemptView[];
  verification: { workItemId: string | null; complete: boolean } | null;
  /**
   * The agency's QA preferences (LA-3.17 · Settings › Sales), so the live QA rail judges with the same
   * rules the server's `ready` guard does. Absent in sample data: the defaults apply.
   */
  qaSettings?: { appointmentBlocks: boolean; per1000Band: { min: number; max: number } };
};

export type PendingRow = RequirementView & { daysOpen: number; daysSinceChase: number | null; ageing: "ok" | "amber" | "red" };
