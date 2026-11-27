/**
 * The web's answers the Money screens read, typed to the fields the phone uses. Each names its route; the server
 * decides who may read it (the web's own role gates), and the phone draws only what came back.
 */

// ─── GET /api/app/agency/my-pay (producer) ─────────────────────────────────────────────────────
export type Basis = "reported" | "received" | string;
export type PayBalance = { basis: Basis; balanceCents: number; earnedCents: number; chargebackCents: number; paidCents: number };
export type PayEntry = {
  id: string; entryType: string; basis: Basis; policyNumber: string | null; carrierId?: string | null; carrierName: string | null; clientName: string | null;
  amountCents: number; occurredOn: string; payoutRunId?: string | null; reason: string | null;
};
export type PayRun = { id: string; periodStart: string; periodEnd: string; status: string; netCents: number; withheldCents: number; paidOn: string | null; paidMethod?: string | null; paymentReference?: string | null };
/** `facts` (added for G1/G7): each carrier's advance length and the month of a policy's life each chargeback came back in. */
export type PayFacts = { advanceMonthsByCarrier: Record<string, number>; policyMonthByEntry: Record<string, number> };
export type MyPay = { balances: PayBalance[]; entries: PayEntry[]; runs: PayRun[]; plan?: unknown; facts?: PayFacts | null };

// ─── GET /api/app/accounting/my-balance (producer, LA-7.5 plans) ───────────────────────────────
export type MyBalance =
  | { visible: false }
  | {
    visible: true; balanceCents: number; owesAgency: boolean;
    entries: { id: string; entryType: string; label: string; policyNumber: string | null; amountCents: number; occurredOn: string; reason: string | null }[];
    runs: { id: string; periodStart: string; periodEnd: string; status: string; earnedCents: number; clawedBackCents: number; withheldCents: number; netCents: number; balanceAfterCents: number; paidOn: string | null }[];
  };

// ─── GET /api/app/agency/statements/[runId] ────────────────────────────────────────────────────
export type StatementLine = {
  id: string; client: string; carrier: string; policy: string; premiumCents: number | null; premiumMode: string | null; levelBps: number | null;
  grossCents: number | null; chargebackCents: number | null; netCents: number; basis: Basis; label: string;
};
export type StatementAnswer = {
  run: { id: string; producerUserId: string; periodStart: string; periodEnd: string; status: string; paidOn: string | null; method: string | null; reference: string | null; withheldCents: number; decision: string | null; decisionReason: string | null };
  producer: string;
  agency: string;
  statement: { openingCents: number; lines: StatementLine[]; adjustments: { id: string; amountCents: number; reason: string }[]; payouts: { id: string; amountCents: number }[]; movementCents: number; closingCents: number };
  /** Per line id (added for G2): the carrier's advance length and, for a chargeback, the month of the policy's life. */
  lineFacts?: Record<string, { advanceMonths: number | null; policyMonth: number | null }>;
};

// ─── GET /api/app/accounting/steps?items=1 (owner, bookkeeper) ─────────────────────────────────
export type TodoGroup = "bank" | "bills" | "expenses" | "payouts" | "tax";
export type TodoItem = {
  key: string; group: TodoGroup; what: string; detail: string; where: string; amountCents: number | null; amountWord?: string; tone?: "bad";
  since: string | null; sinceLabel?: string; next: string; step: string; chip: { label: string; tone: "warning" | "danger" | "neutral"; amount?: boolean }; yours: boolean; href: string;
};
export type StepsAnswer = { counts: Record<string, number>; items?: TodoItem[]; failed?: TodoGroup[] };

// ─── GET /api/app/accounting/pnl/drill?view=summary (owner, bookkeeper) ───────────────────────
export type PnlLine = { section: "in" | "held" | "acquisition" | "overhead" | "splits"; entryType: string; sourceType: "partner" | "vendor" | "expense_category" | null; sourceId: string | null; sourceName: string | null; amountCents: number; entries: number };
export type PnlTotals = { inCents: number; acquisitionCents: number; overheadCents: number; splitsCents: number; netProfitCents: number };
export type PnlSummary = {
  kind: "month" | "quarter" | "year" | "custom"; basis: string; range: { from: string; to: string; label: string }; today: string;
  totals: PnlTotals & { heldCents: number };
  lines: { in: PnlLine[]; acquisition: PnlLine[]; overhead: PnlLine[]; splits: PnlLine[] };
  previous: PnlTotals & { range: { from: string; to: string; label: string } };
  trend: { month: string; inCents: number; acquisitionCents: number; overheadCents: number; splitsCents: number; netCents: number }[];
  /** The month before through the same day (only for the month that holds today): "vs October at this point". */
  previousToDate?: (PnlTotals & { range: { from: string; to: string; label: string } }) | null;
  /** How many people the period's team pay went to. */
  splitPeople?: number | null;
};
export type DrillAnswer = { more: boolean; rows: { entryId?: string; amountCents: number; incurredOn?: string | null; description?: string | null; source: { label: string; href: string } | null }[] };

// ─── GET /api/app/accounting/bank?payments=1 · ?payment=<id> (owner, bookkeeper) ──────────────
export type PaymentVerdict = "missing_money" | "bad_math" | "to_confirm" | "waiting" | "rate_missing" | "all_good";
export type Payment = {
  id: string; carrierId: string; carrierName: string; statementDate: string; paidCents: number; money: "landed" | "to_confirm" | "waiting" | "missing"; verdict: PaymentVerdict;
  dueBy: string; missingCents: number; shortCents: number; landedCents: number;
  deposits: { postedOn: string; appliedCents: number; account: string; confirmed: boolean }[];
  policies?: { policyNumber: string; paidCents: number; promisedCents: number | null; state: "ok" | "short" | "over" | "no_promise"; shortCents: number; findingId: string | null; clientName?: string | null; lineType?: string | null }[];
};

// ─── GET /api/app/accounting/invoices/[id] (owner, bookkeeper) ─────────────────────────────────
export type InvoiceStatus = "draft" | "received" | "approved" | "paid" | "disputed" | "void";
export type Invoice = {
  id: string; sourceType: "vendor" | "partner"; sourceName: string; invoiceNumber: string; invoiceDate: string; periodStart: string | null; periodEnd: string | null; dueDate: string | null;
  totalCents: number; status: InvoiceStatus; paidOn: string | null; flagged: boolean; differenceCents: number | null; paidMethod: string | null; paymentReference: string | null; note: string | null;
  lines: { id: string; description: string; quantity: number; unitPriceCents: number; amountCents: number }[];
  comparison: {
    rows: { lineId: string; invoicedQuantity: number; unitPriceCents: number; countable: boolean; accepted: number; rejected: number; recorded: number; creditedCount: number; creditedCents: number; ourCount: number; ourCents: number; differenceCents: number }[];
    summary: { invoicedCents: number; ourCents: number; differenceCents: number; flagged: boolean; toleranceCents: number; uncountedLines: number };
  };
};

// ─── GET /api/app/accounting/payouts · /payouts/[id] (owner, bookkeeper: partner payouts) ────
export type PartnerRun = { id: string; partnerId: string; partnerName: string; periodStart: string; periodEnd: string; status: "draft" | "published" | "paid" | "void"; netCents: number; grossCents: number; deductionsCents: number; disputedCents: number };
export type PartnerRunDetail = PartnerRun & { lines: { itemType: string; label: string; count: number; rateCents: number | null; amountCents: number }[] };

// ─── GET /api/app/agency/payouts?from&to (owner, bookkeeper: team payouts) ────────────────────
export type PreviewPerson = {
  producerUserId: string; displayName: string; status: string; balanceBeforeCents: number; earnedCents: number; chargebackCents: number; periodCents: number; balanceCents: number;
  alreadyRun: boolean; planModel: string | null; salaryCents: number; bonusCents: number; saveFeeCents: number; absorbedCount: number;
};
/** Per person in the month (added for G4): share of the advance, policies, chargebacks, applications. */
export type TeamFact = { shareBps: number | null; policies: number; chargebacks: number; applications: number };
export type TeamPayoutsAnswer = { period: { from: string; to: string }; preview: PreviewPerson[]; rules: { negativePolicy: string; recoveryPctBp: number }; facts?: Record<string, TeamFact> };

// ─── GET /api/app/discrepancies?view=carriers (owner, bookkeeper) ─────────────────────────────
export type PayIssuesByCarrier = {
  ok: true; available: boolean; owedCents: number; count: number; kinds: Record<string, number>;
  carriers: { carrierKey: string; carrierName: string; owedToYouCents: number; owedToCarrierCents: number; count: number; kinds: Record<string, number> }[];
};

// ─── GET /api/app/accounting/expenses (owner, bookkeeper) ──────────────────────────────────────
export type ExpenseRow = { id: string; category: string; vendorName: string; amountCents: number; incurredOn: string; status: string; paidMethod: string | null };
