/**
 * Partner payouts rework (owner, 2026-11-06; extends LA-7.4 and LA-1.1) · the rulebook, the ledger and
 * the invoice machine's words and arithmetic, with no database. The database does the same sums in
 * 20261106110000; this file is what the screens, the PDF and the tests share.
 *
 *   Model A (the quick win)  a flat rate per successful transfer once the client's application is submitted.
 *   Model B (the long game)  a share of the commission the agency receives on the issued policy.
 *   Timer                    weekly (Mon–Sun), every 15 days (1st–15th, 16th–end), monthly.
 *   Chargebacks              the partner shares them (taken back on the next invoice) or the agency absorbs them.
 *   Ledger                   one entry per thing earned; locked to an invoice when it is created, PAID when
 *                            the invoice is marked paid; never paid twice.
 * Integer cents throughout; no float touches a money figure.
 */

export const PAYOUT_CADENCES = ["weekly", "semi_monthly", "monthly"] as const;
export type PayoutCadence = (typeof PAYOUT_CADENCES)[number];
export const PAYOUT_CADENCE_LABELS: Record<PayoutCadence, string> = {
  weekly: "Every 7 days (weekly)",
  semi_monthly: "Every 15 days",
  monthly: "Every 30 days (monthly)",
};
export const PAYOUT_CADENCE_SHORT: Record<PayoutCadence, string> = { weekly: "weekly", semi_monthly: "every 15 days", monthly: "monthly" };

export const CHARGEBACK_POLICIES = ["partner_shares", "agency_absorbs"] as const;
export type ChargebackPolicy = (typeof CHARGEBACK_POLICIES)[number];
export const CHARGEBACK_POLICY_LABELS: Record<ChargebackPolicy, string> = {
  partner_shares: "The partner shares them: taken back on the next invoice",
  agency_absorbs: "The agency absorbs them",
};

export const PARTNER_PAYMENT_METHODS = ["bank_transfer", "paypal", "zelle", "check", "wire", "other"] as const;
export type PartnerPaymentMethod = (typeof PARTNER_PAYMENT_METHODS)[number];
export const PARTNER_PAYMENT_METHOD_LABELS: Record<PartnerPaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  paypal: "PayPal",
  zelle: "Zelle",
  check: "Check",
  wire: "Wire",
  other: "Other",
};

/** The two models the rulebook offers. Older terms (per transfer, per lead, per sale, per issued policy) keep pricing until replaced. */
export const RULEBOOK_MODELS = ["per_submitted_application", "revenue_share"] as const;
export type RulebookModel = (typeof RULEBOOK_MODELS)[number];
export const RULEBOOK_MODEL_COPY: Record<RulebookModel, { title: string; trigger: string; math: string }> = {
  per_submitted_application: { title: "Model A · The quick win", trigger: "Paid once a transfer is successful and the client's application is submitted.", math: "A flat rate for each one." },
  revenue_share: { title: "Model B · The long game", trigger: "Paid only when the policy is issued, from the commission we receive on it.", math: "A share of that commission." },
};

export type PartnerRulebook = {
  model: RulebookModel | string | null;
  rateCents: number | null;
  ratePctBp: number | null;
  termFrom: string | null;
  cadence: PayoutCadence;
  cadenceOwn: boolean;
  chargebackPolicy: ChargebackPolicy;
  payeeName: string | null;
  payeeEmail: string | null;
  paymentMethod: PartnerPaymentMethod | null;
  paymentNote: string | null;
};

/** "50%" or "12.5%" from basis points, by string handling (no float, no division). */
export function pctLabel(bp: number): string {
  const digits = String(Math.abs(Math.trunc(bp))).padStart(3, "0");
  const whole = digits.slice(0, -2);
  const rest = digits.slice(-2).replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${rest ? `${whole}.${rest}` : whole}%`;
}

/** "12.5" → 1250 basis points; null when it is not a percentage between 0.01 and 100 with at most two decimals. */
export function parsePctToBp(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!m) return null;
  const bp = Number(`${m[1]}${(m[2] ?? "").padEnd(2, "0")}`);
  return bp >= 1 && bp <= 10000 ? bp : null;
}

/** The rulebook's price as one phrase: "$10.00 per submitted application", "50% of the commission". */
export function rulebookRateLabel(model: string | null, rateCents: number | null, ratePctBp: number | null, money: (c: number) => string): string | null {
  if (!model) return null;
  if (model === "revenue_share") return ratePctBp == null ? null : `${pctLabel(ratePctBp)} of the commission`;
  if (rateCents == null) return null;
  const unit: Record<string, string> = { per_submitted_application: "submitted application", per_transfer: "transfer", per_lead: "lead", per_sale: "sale", per_issued_policy: "issued policy" };
  return `${money(rateCents)} per ${unit[model] ?? model.replace(/_/g, " ")}`;
}

export const isRulebookModel = (model: string | null | undefined): model is RulebookModel => model === "per_submitted_application" || model === "revenue_share";

// ─── the timer ─────────────────────────────────────────────────────────────────────────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monthEnd = (day: string) => { const d = utc(day); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };

/** The cycle `day` falls in — the same rule as public.partner_payout_cycle. */
export function payoutCycle(cadence: PayoutCadence | string, day: string): { start: string; end: string } {
  const d = utc(day);
  if (cadence === "weekly") {
    const back = (d.getUTCDay() + 6) % 7; // Monday = 0
    const start = addDays(day, -back);
    return { start, end: addDays(start, 6) };
  }
  const first = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  if (cadence === "semi_monthly") {
    return d.getUTCDate() <= 15 ? { start: first, end: addDays(first, 14) } : { start: addDays(first, 15), end: monthEnd(day) };
  }
  return { start: first, end: monthEnd(day) };
}

/** The cycle that ended last as of `asOf` — what the invoice machine invoices. */
export function lastCompleteCycle(cadence: PayoutCadence | string, asOf: string) {
  return payoutCycle(cadence, addDays(payoutCycle(cadence, asOf).start, -1));
}

/**
 * When the partner can expect an unpaid item to be invoiced: the end of the cycle it falls in (or,
 * when that cycle has passed without an invoice, the current one), plus the agency's draft days.
 */
export function expectedPayOn(cadence: PayoutCadence | string, earnedOn: string, today: string, draftDays: number): string {
  const from = earnedOn > today ? earnedOn : today;
  return addDays(payoutCycle(cadence, from).end, Math.max(0, Math.min(28, Math.trunc(draftDays))) + 1);
}

// ─── a client's journey ────────────────────────────────────────────────────────────────────────
export type TrackerRow = {
  dealId: string;
  partnerId: string;
  clientName: string;
  transferredOn: string | null;
  submittedOn: string | null;
  issuedOn: string | null;
  policyNumber: string | null;
  carrier: string | null;
  chargedBackOn: string | null;
  payableCents: number;
  unpaidCents: number;
  invoicedCents: number;
  paidCents: number;
  entries: number;
  openFrom: string | null;
  lastRunId: string | null;
};

export const CLIENT_STAGES = ["transferred", "submitted", "issued", "charged_back"] as const;
export type ClientStage = (typeof CLIENT_STAGES)[number];
export const CLIENT_STAGE_LABELS: Record<ClientStage, string> = { transferred: "Transferred", submitted: "App submitted", issued: "Issued", charged_back: "Charged back" };

export function clientStage(row: Pick<TrackerRow, "submittedOn" | "issuedOn" | "chargedBackOn">): ClientStage {
  if (row.chargedBackOn) return "charged_back";
  if (row.issuedOn) return "issued";
  if (row.submittedOn) return "submitted";
  return "transferred";
}

export type LedgerState = "nothing_yet" | "unpaid" | "invoiced" | "paid";
export const LEDGER_STATE_LABELS: Record<LedgerState, string> = { nothing_yet: "Nothing earned yet", unpaid: "Unpaid", invoiced: "On an invoice", paid: "PAID" };

/** Where a client's money stands: anything unpaid wins, then anything on an invoice, then PAID. */
export function ledgerState(row: Pick<TrackerRow, "entries" | "unpaidCents" | "invoicedCents" | "paidCents" | "openFrom">): LedgerState {
  if (!row.entries) return "nothing_yet";
  if (row.openFrom) return "unpaid";
  if (row.invoicedCents !== 0) return "invoiced";
  return "paid";
}

// ─── the ledger, entry by entry ────────────────────────────────────────────────────────────────
export const LEDGER_SOURCE_LABELS: Record<string, string> = {
  submitted_application: "Application submitted",
  commission: "Commission share",
  chargeback_clawback: "Chargeback taken back",
  credit: "Credit accepted",
  carried_balance: "Balance carried from an earlier invoice",
  transfer: "Transfer",
  lead: "Lead",
  sale: "Sale",
  issued_policy: "Issued policy",
};

export type LedgerEntry = {
  id: string;
  partnerId: string;
  sourceType: string;
  dealId: string | null;
  policyNumber: string | null;
  carrier: string | null;
  earnedOn: string;
  rateCents: number | null;
  ratePctBp: number | null;
  basisCents: number | null;
  amountCents: number;
  note: string | null;
  runId: string | null;
  paidAt: string | null;
};

export function entryState(e: Pick<LedgerEntry, "runId" | "paidAt">): Exclude<LedgerState, "nothing_yet"> {
  return e.paidAt ? "paid" : e.runId ? "invoiced" : "unpaid";
}

/** "50% of $1,000.00" for a commission share; the flat rate for Model A; nothing for the rest. */
export function entryMath(e: Pick<LedgerEntry, "sourceType" | "rateCents" | "ratePctBp" | "basisCents">, money: (c: number) => string): string | null {
  if (e.sourceType === "commission" && e.ratePctBp != null && e.basisCents != null) return `${pctLabel(e.ratePctBp)} of ${money(e.basisCents)}`;
  if ((e.sourceType === "submitted_application" || e.sourceType === "chargeback_clawback") && e.rateCents != null) return `at ${money(e.rateCents)}`;
  return null;
}

/** What the next invoice would hold: the sum of the unlocked entries up to the cycle's end. */
export function invoicePreview(entries: Pick<LedgerEntry, "earnedOn" | "amountCents" | "runId">[], cycleEnd: string) {
  const open = entries.filter((e) => !e.runId && e.earnedOn <= cycleEnd);
  return { items: open.length, netCents: open.reduce((s, e) => s + e.amountCents, 0) };
}

// ─── the invoice, line by line (the PDF and the partner's screen) ─────────────────────────────
export type InvoiceItem = {
  itemType: string;
  occurredOn: string;
  amountCents: number;
  rateCents: number | null;
  ratePctBp: number | null;
  basisCents: number | null;
  clientName: string | null;
  policyNumber: string | null;
  carrier: string | null;
  note: string | null;
};

export type InvoiceLine = { date: string; what: string; detail: string; math: string; amountCents: number };

const ITEM_WORDS: Record<string, string> = {
  submitted_application: "Application submitted",
  revenue_share: "Commission share",
  clawback: "Chargeback taken back",
  carried_balance: "Balance from an earlier invoice",
  credit: "Credit accepted",
  adjustment: "Dispute accepted",
  transfer: "Transfer",
  lead: "Lead",
  sale: "Sale",
  issued_policy: "Issued policy",
};

/** Each priced item as one invoice line showing the math; rejected transfers are not lines (a count). */
export function invoiceLines(items: InvoiceItem[], money: (c: number) => string): InvoiceLine[] {
  return items
    .filter((i) => i.itemType !== "rejected" && i.itemType !== "dispute")
    .map((i) => ({
      date: i.occurredOn,
      what: ITEM_WORDS[i.itemType] ?? i.itemType,
      detail: [i.clientName, i.policyNumber && `policy ${i.policyNumber}`, i.carrier].filter(Boolean).join(" · ") || (i.note ?? ""),
      math: i.itemType === "revenue_share" && i.ratePctBp != null && i.basisCents != null
        ? `${pctLabel(i.ratePctBp)} of ${money(i.basisCents)}`
        : i.rateCents != null && (i.itemType === "submitted_application" || i.itemType === "clawback" || i.itemType === "transfer" || i.itemType === "lead" || i.itemType === "sale" || i.itemType === "issued_policy")
          ? `${money(i.rateCents)} each`
          : "",
      amountCents: i.amountCents,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** "INV-202611-0004", or the short run reference for an invoice made before numbering. */
export const invoiceRef = (run: { id: string; invoiceNumber?: string | null }) => run.invoiceNumber || `RUN-${run.id.slice(0, 8).toUpperCase()}`;
