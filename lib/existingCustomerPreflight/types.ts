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
  /**
   * LA-1.24-5: every partner that already sold this person (a sold lead match), one each, and
   * whether that is two or more. Worked out from `matches` (./soldBy.ts), so a result stored
   * before this existed reads the same way.
   */
  soldByPartners?: Array<{ partnerId: string; partnerName: string }>;
  soldByMultiplePartners?: boolean;
  error?: string;
};
