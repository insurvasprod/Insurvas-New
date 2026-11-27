import type { AttemptView, CaseView, InterviewQuestion, InterviewView } from "./types";

/** A case in the shape GET /api/app/applications/cases/:id answers (checked against the demo agency's). */
export const QUESTIONS: InterviewQuestion[] = [
  { key: "health_heart", label: "In the past 2 years, have you been treated for congestive heart failure?", type: "boolean", required: true, section: "Health", knockout: { when: true, note: "A yes declines level; quote graded." } },
  { key: "ss_deposit_day", label: "When does your Social Security arrive?", type: "single_select", options: ["2nd Wednesday", "3rd Wednesday"], required: true, section: "Before we start", persistency: true },
  { key: "existing_coverage", label: "Do you have any life insurance now?", type: "boolean", required: true, section: "Before we start", persistency: true },
  { key: "existing_cash_value", label: "Does that policy have a cash value you plan to move?", type: "boolean", section: "Before we start", showWhen: { key: "existing_coverage", equals: true } },
  { key: "health_height", label: "How tall are you?", type: "number", section: "Health" },
  { key: "medications", label: "Which medicines do you take?", type: "medication_list", section: "Medications" },
];

export function interview(over: Partial<InterviewView> = {}): InterviewView {
  return { id: "iv1", completedAt: null, questions: QUESTIONS, answers: {}, medications: [], ...over };
}

export function attempt(over: Partial<AttemptView> = {}): AttemptView {
  return {
    id: "a1", attemptNo: 1, insuredRole: "primary", status: "draft", carrierName: null, carrierPortalUrl: null, productCode: "final_expense", productLabel: null, tier: null,
    selectedQuoteId: null, values: { "insured.first_name": { value: "Linda" }, "insured.last_name": { value: "Okafor" }, "insured.dob": { value: "1958-04-14" } },
    requiredKeys: ["insured.first_name"], payment: null, beneficiaries: [], disclosures: [], quotes: [], submissions: [], ...over,
  };
}

export function kase(over: Partial<CaseView> = {}, a: Partial<AttemptView> = {}, iv: Partial<InterviewView> | null = {}): CaseView {
  return {
    caseId: "c1", leadId: "l1", status: "open", clientName: "Linda Okafor", clientState: "GA", requestedFaceCents: 1_500_000,
    interviews: iv ? { primary: interview(iv) } : {}, attempts: [attempt(a)], verification: { workItemId: "w1", complete: true }, submitGate: { canSubmit: true, code: null, reason: null }, ...over,
  };
}
