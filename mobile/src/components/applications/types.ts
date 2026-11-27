/**
 * The shapes the phone reads from the web's application routes (lib/applications/types.ts on the
 * server), cut to the fields these screens use. Sensitive values never arrive in plain text: a bank
 * number comes as `masked` plus `hasValue`, and the real value only from one reveal call.
 */

export type ApplicationStatus = "draft" | "ready" | "submitted" | "pending_carrier" | "counteroffer_pending" | "closed";

/** GET /api/app/applications, one row per attempt. */
export type ApplicationRow = {
  caseId: string;
  applicationId: string;
  leadId: string;
  clientName: string;
  insuredRole: "primary" | "spouse";
  state: string | null;
  carrierName: string | null;
  productLabel: string | null;
  attemptNo: number;
  status: ApplicationStatus;
  monthlyPremiumCents: number | null;
  updatedAt: string;
};

export type AnswerValue = string | boolean | number | string[] | null;

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
  persistency?: boolean;
};

export type Answers = Record<string, { value: AnswerValue; notes?: string }>;

export type InterviewView = {
  id: string;
  completedAt: string | null;
  questions: InterviewQuestion[];
  answers: Answers;
  medications: { id: string; name: string }[];
};

export type FieldValue = { value: string | number | boolean | null; masked?: string; hasValue?: boolean };

export type QuoteView = {
  id: string;
  carrierId: string;
  carrierName: string;
  productLabel: string;
  tier: string;
  faceAmountCents: number;
  monthlyPremiumCents: number;
  status: "draft" | "presented" | "selected" | "discarded";
  appointed: { ok: boolean; reason: string | null };
  warnings: { code: string; message: string }[];
};

export type IncomeType = "ssa" | "ssi" | "ssa_ssi" | "pension" | "payroll" | "va" | "none";

export type PaymentView = {
  method: "ach" | "direct_express" | "debit_card" | "credit_card" | "direct_bill";
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
};

export type AttemptView = {
  id: string;
  attemptNo: number;
  insuredRole: "primary" | "spouse";
  status: ApplicationStatus;
  carrierName: string | null;
  carrierPortalUrl: string | null;
  productCode: string | null;
  productLabel: string | null;
  tier: string | null;
  selectedQuoteId: string | null;
  values: Record<string, FieldValue>;
  requiredKeys: string[];
  payment: PaymentView | null;
  beneficiaries: { id: string; first_name: string; last_name: string; share_bp: number; tier: "primary" | "contingent" }[];
  disclosures: { id: string; status: "required" | "acknowledged" | "not_applicable" }[];
  quotes: QuoteView[];
  submissions: { id: string; submittedAt: string }[];
};

export type CaseView = {
  caseId: string;
  leadId: string;
  status: "open" | "closed";
  clientName: string;
  clientState: string | null;
  requestedFaceCents?: number | null;
  interviews: Partial<Record<"primary" | "spouse", InterviewView>>;
  attempts: AttemptView[];
  verification: { workItemId: string | null; complete: boolean } | null;
  submitGate?: { canSubmit: boolean; code: string | null; reason: string | null } | null;
};

/** GET /api/app/applications/cases/:id/catalog — the carriers this agency may quote on the case. */
export type Catalog = {
  carriers: { id: string; name: string; appointed: { ok: boolean; reason: string | null }; products: { id: string; name: string; productCode: string; tiers: string[] }[] }[];
};

/** POST /api/app/draft-dates/recommend — the optimiser's answer (lib/draftDates/optimiser.ts). */
export type DraftOption = { day: number; minGapDays: number; reason: string };
export type DraftRecommendation =
  /** `arrivals`: the deposit each coming month (lib/draftDates/optimiser.ts firstPerMonth), for real dates. */
  | { kind: "recommended" | "neutral"; recommended: DraftOption; alternates: DraftOption[]; schedule: string; arrivals?: { month: string; date: string }[]; why?: string }
  | { kind: "not_applicable"; why: string };
