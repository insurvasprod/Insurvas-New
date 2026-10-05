/**
 * DESIGN FIXTURES — LA-3 Design phase only.
 *
 * Sample data in the exact shapes the API will return (`./types`), so the page designs can be
 * reviewed before the schema lands. Every page that imports this file shows the "Sample data"
 * notice. The Build phase replaces each import with a fetch; nothing here is ever written anywhere,
 * and no server route may import it. Names, numbers and policy numbers are invented.
 */

import type { ApplicationListRow, AttemptView, CaseView, InterviewView, PendingRow, QuoteView } from "./types";

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);
const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

export const FIXTURE_CASE_ID = "c0ffee00-0000-4000-8000-000000000001";

const INTERVIEW: InterviewView = {
  id: "iv-1",
  templateName: "Final Expense — general intake",
  templateRevision: 3,
  startedAt: daysAgo(9),
  completedAt: daysAgo(9),
  questions: [
    { key: "ss_deposit_day", section: "Before we start", label: "When does your Social Security arrive?", type: "single_select", options: ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"], persistency: true, required: true, help: "Sets the draft date — the biggest lever on month-4 lapse." },
    { key: "deposit_account", section: "Before we start", label: "Is the account you'll pay from the one it lands in?", type: "boolean", persistency: true, required: true },
    { key: "decision_maker", section: "Before we start", label: "Does anyone else need to be on this call?", type: "boolean", persistency: true },
    { key: "existing_coverage", section: "Before we start", label: "Do you have any life insurance now?", type: "boolean", persistency: true, required: true, help: "A yes brings up the replacement notice." },
    { key: "can_receive_text", section: "Before we start", label: "Can you get a text or email without hanging up?", type: "boolean", persistency: true },
    { key: "oxygen", section: "Health", label: "In the last 2 years, have you used oxygen equipment?", type: "boolean", required: true, knockout: { when: true, note: "most carriers treat this as a decline or a graded rating." } },
    { key: "dialysis", section: "Health", label: "Are you on kidney dialysis?", type: "boolean", required: true, knockout: { when: true, note: "most carriers treat this as a decline." } },
    { key: "cancer", section: "Health", label: "Have you been diagnosed with or treated for cancer in the last 3 years?", type: "boolean", required: true },
    { key: "cancer_when", section: "Health", label: "When was it diagnosed?", type: "date", showWhen: { key: "cancer", equals: true } },
    { key: "cancer_type", section: "Health", label: "What type?", type: "text", showWhen: { key: "cancer", equals: true } },
    { key: "heart", section: "Health", label: "Have you had heart failure, a heart attack or heart surgery in the last 2 years?", type: "boolean", required: true },
    { key: "diabetes", section: "Health", label: "Do you have diabetes?", type: "boolean", required: true },
    { key: "diabetes_insulin", section: "Health", label: "Do you use insulin?", type: "boolean", showWhen: { key: "diabetes", equals: true } },
    { key: "medications", section: "Medications", label: "Medications", type: "medication_list" },
    { key: "notes", section: "Notes", label: "Anything else the carrier should know", type: "long_text" },
  ],
  answers: {
    ss_deposit_day: { value: "3rd Wednesday" },
    deposit_account: { value: true },
    decision_maker: { value: false },
    existing_coverage: { value: true, notes: "Small Globe policy, $5k — keeping it." },
    can_receive_text: { value: true },
    oxygen: { value: false },
    dialysis: { value: false },
    cancer: { value: false },
    heart: { value: false },
    diabetes: { value: true },
    diabetes_insulin: { value: false },
  },
  medications: [
    { id: "m1", name: "Metformin", dose: "500 mg", since: "2019", prescribedFor: "Type 2 diabetes", prescribedForUnknown: false },
    { id: "m2", name: "Lisinopril", dose: "10 mg", since: "2021", prescribedFor: "Blood pressure", prescribedForUnknown: false },
    { id: "m3", name: "Furosemide", dose: "20 mg", since: "2023", prescribedFor: "", prescribedForUnknown: true },
  ],
};

const QUOTES: QuoteView[] = [
  { id: "q1", carrierId: "car-mutual", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 1_000_000, monthlyPremiumCents: 6_840, riders: [], ageUsed: 72, status: "selected", appointed: { ok: true, reason: null }, acceptsPaymentMethod: true, warnings: [], payout: { fycCents: 86_184, advanceCents: 64_638, advanceMonths: 9, contractLevelBp: 10_500 }, createdAt: daysAgo(2) },
  { id: "q2", carrierId: "car-aetna", carrierName: "Aetna", productLabel: "Protection Series", tier: "graded", faceAmountCents: 1_000_000, monthlyPremiumCents: 5_910, riders: [], ageUsed: 72, status: "discarded", appointed: { ok: true, reason: null }, acceptsPaymentMethod: true, warnings: [], payout: { fycCents: 70_920, advanceCents: 53_190, advanceMonths: 9, contractLevelBp: 10_000 }, createdAt: daysAgo(2) },
  { id: "q3", carrierId: "car-americo", carrierName: "Americo", productLabel: "Eagle Premier", tier: "level", faceAmountCents: 1_200_000, monthlyPremiumCents: 7_920, riders: [{ name: "Accidental death", monthlyPremiumCents: 410 }], ageUsed: 72, status: "discarded", appointed: { ok: false, reason: "No active Americo appointment in TX." }, acceptsPaymentMethod: true, warnings: [], payout: { fycCents: 109_296, advanceCents: 81_972, advanceMonths: 9, contractLevelBp: 11_500 }, createdAt: daysAgo(2) },
];

const ATTEMPT_1: AttemptView = {
  id: "att-1", caseId: FIXTURE_CASE_ID, attemptNo: 1, insuredRole: "primary",
  status: "closed", outcome: "declined", outcomeReasonCode: "medication", outcomeReasonText: "Declined for furosemide — carrier treats as heart failure.",
  carrierId: "car-foresters", carrierName: "Foresters", carrierPortalUrl: "https://agent.example-foresters.test", portalUsername: "ray.m", productCode: "final_expense", productLabel: "PlanRight", tier: "level", selectedQuoteId: "q0",
  values: {}, requiredKeys: [], payment: null, beneficiaries: [], disclosures: [],
  quotes: [{ ...QUOTES[0], id: "q0", carrierId: "car-foresters", carrierName: "Foresters", productLabel: "PlanRight", monthlyPremiumCents: 6_450, status: "selected", createdAt: daysAgo(9) }],
  requirements: [], counteroffers: [],
  submissions: [{ id: "sub-0", attemptNo: 1, carrierReference: "FR-2291834", referenceKind: "application_no", policyNumber: null, submittedAt: daysAgo(9), submittedVia: "copy_assist", hasConfirmation: true, qaVerdict: "pass_with_warnings" }],
  welcomePack: { status: "sent", recipient: "rita.alvarez@example.test", sentAt: daysAgo(9) },
  appointment: { ok: true, reason: null }, product: null, submittedAt: daysAgo(9), closedAt: daysAgo(3), createdAt: daysAgo(9),
};

export const FIXTURE_ATTEMPT: AttemptView = {
  id: "att-2", caseId: FIXTURE_CASE_ID, attemptNo: 2, insuredRole: "primary",
  status: "draft", outcome: null, outcomeReasonCode: null, outcomeReasonText: null,
  carrierId: "car-mutual", carrierName: "Mutual of Omaha", carrierPortalUrl: "https://producer.example-mutual.test", portalUsername: "rmason", productCode: "final_expense", productLabel: "Living Promise", tier: "level", selectedQuoteId: "q1",
  values: {
    "insured.first_name": { value: "Rita", source: "lead", reviewed: true },
    "insured.middle_initial": { value: "M", source: "carried_forward", reviewed: true },
    "insured.last_name": { value: "Alvarez", source: "lead", reviewed: true },
    "insured.dob": { value: "1953-03-14", source: "lead", reviewed: true },
    "insured.gender": { value: "female", source: "interview", reviewed: true },
    "insured.ssn": { value: null, source: "carried_forward", reviewed: true, masked: "••••1847", hasValue: true },
    "insured.birth_state": { value: "TX", source: "carried_forward", reviewed: false },
    "insured.height_in": { value: 64, source: "interview", reviewed: true },
    "insured.weight_lb": { value: 171, source: "interview", reviewed: true },
    "insured.tobacco": { value: "no", source: "interview", reviewed: true },
    "contact.phone": { value: "8175550142", source: "lead", reviewed: true },
    "contact.email": { value: "rita.alvarez@example.test", source: "lead", reviewed: true },
    "addr.line1": { value: "4118 Sycamore Ln", source: "lead", reviewed: true },
    "addr.city": { value: "Fort Worth", source: "lead", reviewed: true },
    "addr.state": { value: "TX", source: "lead", reviewed: true },
    "addr.zip": { value: "76133", source: "lead", reviewed: true },
    "owner.same_as_insured": { value: true, source: "carried_forward", reviewed: true },
    "cov.face_amount": { value: 1_000_000, source: "quote", reviewed: true },
    "cov.product_tier": { value: "level", source: "quote", reviewed: true },
    "cov.monthly_premium": { value: 6_840, source: "quote", reviewed: true },
  },
  requiredKeys: ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.birth_state", "insured.height_in", "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip"],
  payment: {
    method: "ach", draftDay: 24, draftDayRecommended: 24, draftOverrideReason: null, incomeType: "ssa", incomeInputs: { birthDay: 14 },
    accountType: "checking", bankName: "Frost Bank", nameOnAccount: "Rita M Alvarez",
    routing: { masked: "••••0021", hasValue: true }, account: { masked: "••••4410", hasValue: true },
  },
  beneficiaries: [
    { id: "b1", tier: "primary", first_name: "Daniel", last_name: "Alvarez", relationship: "child", dob: "1978-06-02", share_bp: 5_000 },
    { id: "b2", tier: "primary", first_name: "Marisol", last_name: "Reyes", relationship: "child", dob: "1981-11-19", share_bp: 5_000 },
    { id: "b3", tier: "contingent", first_name: "Sofia", last_name: "Reyes", relationship: "grandchild", dob: "2009-04-07", share_bp: 10_000 },
  ],
  disclosures: [
    { id: "d1", code: "REPLACEMENT_NOTICE", title: "Notice regarding replacement", body: "You told us you already have life insurance. Before you buy this policy, you should know whether it replaces or changes the policy you have. Read this notice before you decide.", version: 2, status: "required", method: null, note: null, acknowledgedBy: null, acknowledgedAt: null },
  ],
  quotes: QUOTES,
  requirements: [], counteroffers: [], submissions: [], welcomePack: null,
  appointment: { ok: true, reason: null },
  product: { issueAgeMin: 45, issueAgeMax: 85, faceMinCents: 200_000, faceMaxCents: 5_000_000, acceptedPaymentMethods: ["ach", "direct_express", "debit_card", "credit_card", "direct_bill"] },
  submittedAt: null, closedAt: null, createdAt: daysAgo(3),
};

export const FIXTURE_CASE: CaseView = {
  caseId: FIXTURE_CASE_ID,
  leadId: "lead-rita",
  status: "open",
  source: "outbound",
  clientName: "Rita M Alvarez",
  clientState: "TX",
  clientPhone: "8175550142",
  campaignName: "TX aged FE — Sept",
  openedAt: daysAgo(9),
  interviews: { primary: INTERVIEW },
  attempts: [ATTEMPT_1, FIXTURE_ATTEMPT],
  verification: { workItemId: null, complete: true },
};

const row = (r: Partial<ApplicationListRow> & Pick<ApplicationListRow, "clientName" | "status">, i: number): ApplicationListRow => ({
  caseId: `case-${i}`, applicationId: `app-${i}`, leadId: `lead-${i}`, insuredRole: "primary", state: "TX", carrierName: "Mutual of Omaha", productLabel: "Living Promise",
  attemptNo: 1, outcome: null, monthlyPremiumCents: 6_840, qaVerdict: null, reference: null, policyNumber: null, updatedAt: daysAgo(i), ...r,
});

export const FIXTURE_APPLICATIONS: ApplicationListRow[] = [
  row({ caseId: FIXTURE_CASE_ID, clientName: "Rita M Alvarez", status: "draft", attemptNo: 2, qaVerdict: "fail" }, 0),
  row({ clientName: "Dolores Ruiz", state: "AZ", carrierName: "Americo", productLabel: "Eagle Premier", status: "ready", monthlyPremiumCents: 7_100, qaVerdict: "pass" }, 1),
  row({ clientName: "Harold Briggs", state: "OK", status: "submitted", monthlyPremiumCents: 5_425, qaVerdict: "pass_with_warnings", reference: null }, 2),
  row({ clientName: "Evelyn Carter", state: "TX", carrierName: "Aetna", productLabel: "Protection Series", status: "pending_carrier", monthlyPremiumCents: 8_210, qaVerdict: "pass", reference: "AE-5508123" }, 3),
  row({ clientName: "Walter Kim", state: "NM", carrierName: "Aetna", status: "counteroffer_pending", monthlyPremiumCents: 9_150, qaVerdict: "pass", reference: "AE-5507741" }, 4),
  row({ clientName: "Betty Kim", insuredRole: "spouse", state: "NM", carrierName: "Mutual of Omaha", status: "submitted", monthlyPremiumCents: 6_020, qaVerdict: "pass", reference: "MO-88213401" }, 4),
  row({ clientName: "Frank Delgado", state: "TX", status: "closed", outcome: "issued", monthlyPremiumCents: 4_870, qaVerdict: "pass", reference: "MO-88199230", policyNumber: "BU2231178" }, 6),
  row({ clientName: "Nancy Whitfield", state: "OK", carrierName: "Foresters", productLabel: "PlanRight", status: "closed", outcome: "declined", monthlyPremiumCents: 6_300, qaVerdict: "pass_with_warnings", reference: "FR-2290017" }, 8),
];

export const FIXTURE_PENDING: PendingRow[] = [
  { id: "r1", applicationId: "app-3", caseId: "case-3", clientName: "Evelyn Carter", carrierName: "Aetna", monthlyPremiumCents: 8_210, kind: "phone_interview", description: "Carrier's phone interview — they have tried twice.", waitingOn: "client", status: "open", raisedAt: dateAgo(8), dueAt: null, lastChasedAt: daysAgo(3), chaseCount: 2, daysOpen: 8, daysSinceChase: 3, ageing: "amber" },
  { id: "r2", applicationId: "app-4", caseId: "case-4", clientName: "Walter Kim", carrierName: "Aetna", monthlyPremiumCents: 9_150, kind: "counteroffer", description: "Approved Graded at $91.50, applied Level at $74.20.", waitingOn: "client", status: "open", raisedAt: dateAgo(2), dueAt: daysAhead(5).slice(0, 10), lastChasedAt: null, chaseCount: 0, daysOpen: 2, daysSinceChase: null, ageing: "ok" },
  { id: "r3", applicationId: "app-3", caseId: "case-3", clientName: "Evelyn Carter", carrierName: "Aetna", monthlyPremiumCents: 8_210, kind: "aps", description: "Attending physician statement from Dr Nguyen.", waitingOn: "third_party", status: "in_progress", raisedAt: dateAgo(14), dueAt: null, lastChasedAt: daysAgo(6), chaseCount: 1, daysOpen: 14, daysSinceChase: 6, ageing: "red" },
  { id: "r4", applicationId: "app-9", caseId: "case-9", clientName: "Gloria Pham", carrierName: "Mutual of Omaha", monthlyPremiumCents: 5_880, kind: "missing_info", description: "Beneficiary date of birth missing.", waitingOn: "agent", status: "open", raisedAt: dateAgo(1), dueAt: null, lastChasedAt: null, chaseCount: 0, daysOpen: 1, daysSinceChase: null, ageing: "ok" },
  { id: "r5", applicationId: "app-10", caseId: "case-10", clientName: "Raymond Ortiz", carrierName: "Americo", monthlyPremiumCents: 6_640, kind: "voice_verification", description: "Carrier voice verification of the bank draft.", waitingOn: "client", status: "open", raisedAt: dateAgo(12), dueAt: null, lastChasedAt: daysAgo(9), chaseCount: 3, daysOpen: 12, daysSinceChase: 9, ageing: "red" },
];

export const FIXTURE_COUNTEROFFER = {
  id: "co-1",
  clientName: "Walter Kim",
  caseId: "case-4",
  carrierName: "Aetna",
  receivedAt: daysAgo(2),
  applied: { tier: "level", healthClass: null, faceCents: 1_500_000, monthlyCents: 7_420 },
  offered: { tier: "graded", healthClass: null, faceCents: 1_500_000, monthlyCents: 9_150 },
  reason: "Recent hospitalisation (COPD), 2024.",
  expiresAt: daysAhead(5),
  status: "pending_client" as const,
};
