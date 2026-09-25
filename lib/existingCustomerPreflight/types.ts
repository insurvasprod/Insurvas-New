export type PreflightStatus = "new_household" | "spoken_before" | "already_customer" | "not_checked";

export type PreflightMatch = {
  leadId: string | null;
  contactId: string | null;
  submittedAt: string;
  partnerId: string | null;
  partnerName: string | null;
  productLine: string | null;
  outcome: string | null;
  score: number;
  matchedOn: string[];
  sourceType: "lead" | "contact";
};

export type PreflightResult = {
  status: PreflightStatus;
  policyMatchingIncluded: false;
  policyMatchingNote: string;
  checkedAt: string | null;
  matches: PreflightMatch[];
  error?: string;
};
