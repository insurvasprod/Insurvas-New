/**
 * What the Retention routes answer the phone (release 2, boards B7 and F3–F5). The shapes are the ones the web
 * routes write: GET /api/app/retention/cases (the list, or `?id=` one case), GET /api/app/retention/servicing
 * `?list=waiting`, GET /api/app/retention/winback and GET /api/app/retention/servicing/policies `?q=`.
 */
export type Step = "payment_problem" | "pending_lapse" | "lapsed_reinstatable" | "lost" | "paperwork";
export type CaseStatus = "open" | "working" | "waiting_on_carrier" | "saved" | "lost" | "closed_no_save";

export type CaseEvidence = {
  status: string | null; carrierWord: string | null; fileDate: string | null; paidTo: string | null;
  lapsedOn: string | null; daysPastDue: number | null; byPerson: boolean;
};

export type CaseItem = {
  id: string; clientName: string | null; carrierName: string; policyNumber: string;
  step: Step; reason: string; reasonLabel: string; status: CaseStatus;
  /** The carrier's real date (YYYY-MM-DD), never moved to today when it has passed. */
  deadline: string | null;
  /** Days to the deadline; negative once it has passed. */
  daysLeft: number | null;
  contactAttempts: number; unreachable: boolean; lastContactAt: string | null;
  lastCall: { at: string; outcome: string } | null;
  openedAt: string; evidence: CaseEvidence;
  /** Board F5's "Try again" (ISO instant) set with the latest call; null or absent when none. */
  nextAttemptAt?: string | null;
};

export type CasesAnswer =
  | { available: true; today: string; lastFileDate: string | null; cases: CaseItem[]; month: { saved: number; lost: number; closedNoSave: number } }
  | { available: false; message: string };

export type CaseCall = { at: string; outcome: string; did: string | null; note: string | null; by: string | null };
export type CaseDetail = CaseItem & {
  phone: string | null; monthlyCents: number | null; product: string | null; ownerName: string | null;
  servicingRequestId: string | null; nextAction: string; resolvedAt: string | null; outcomeReason: string | null;
  calls: CaseCall[];
  /** Board F4 / F5 (2026-11-27, additive): the lead behind the policy and whether this person may use the dialer; the client's
   * state and zone ("her time"); the carrier file row the evidence came from; "She'll call the carrier" with the latest call. */
  leadId?: string | null; canDial?: boolean;
  clientState?: string | null; clientZone?: string | null;
  fileRow?: number | null; clientCallsCarrier?: boolean;
};
export type CaseAnswer = { case: CaseDetail };

/** The servicing request types, and a reinstatement sent to the carrier (the waiting list's own row, `winback` plan). */
export type RequestType = "draft_date_change" | "payment_method_change" | "bill_to_draft_conversion" | "address_change" | "reinstatement";
export type RequestStatus = "draft" | "submitted" | "awaiting_carrier" | "confirmed_by_carrier" | "verified_in_file" | "failed" | "cancelled";
export type WaitingRequest = {
  id: string; caseId: string | null; clientName: string | null; carrierName: string; policyNumber: string;
  type: RequestType; status: RequestStatus; createdAt: string; submittedAt: string | null; expectedEffectiveDate: string | null;
  verifiedAt: string | null; verifiedSnapshotDate: string | null; checkedSnapshotDate: string | null;
  /** The carrier's file cannot show this change, so a person has to check it. */
  unprovable: boolean;
};
export type WaitingAnswer = { available: true; requests: WaitingRequest[] } | { available: false; message: string };

export type WinbackPerson = {
  id: string; clientName: string | null; carrierName: string; policyNumber: string; lapsedOn: string;
  category: string; band: string; eligibleFrom: string | null; releasedAt: string | null; leadId: string | null; blockedReason: string | null;
  /** Dialer attempts on the released lead (null: no lead yet; absent from an older server). */
  calls?: { count: number; lastDisposition: string | null } | null;
};
export type WinbackAnswer = { available: true; today: string; people: WinbackPerson[] } | { available: false; message: string };

export type PolicyMatch = { carrierId: string; carrierName: string; policyNumber: string; clientName: string | null; phone: string | null; status: string | null };
