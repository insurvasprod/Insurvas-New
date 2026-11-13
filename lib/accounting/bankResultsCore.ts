/**
 * Bank deposits › Results (owner's Accounting doc, "The Bank Matchmaker", 2026-11-07). One verdict per
 * carrier payment, from three truths already in the database:
 *
 *   - what the carrier says it paid (carrier_account_statement.amount_paid_cents),
 *   - what the bank shows landed (deposit_match, confirmed or still a suggestion),
 *   - whether each policy on that payment was paid what we were promised (commission_discrepancy,
 *     LA-4.15's verdict against the rate card; expected_commission when nothing is flagged).
 *
 * Pure: no I/O, integer cents, ISO dates. The window is the agency's bank window (Settings ›
 * Accounting › "Look for the deposit up to N days after"): past it with nothing landed is missing money,
 * but only once the imported bank lines reach that far; before then it is "waiting", never an alarm.
 */

export type MoneyState = "landed" | "to_confirm" | "waiting" | "missing";
export type PolicyState = "ok" | "short" | "over" | "no_promise";
export type PaymentVerdict = "missing_money" | "bad_math" | "to_confirm" | "waiting" | "rate_missing" | "all_good";

export const VERDICT_LABELS: Record<PaymentVerdict, string> = {
  missing_money: "Missing money",
  bad_math: "Bad math",
  to_confirm: "Deposit to confirm",
  waiting: "Waiting for the bank",
  rate_missing: "Paid · rate missing",
  all_good: "All good",
};

export const VERDICT_TONES: Record<PaymentVerdict, "danger" | "warning" | "info" | "neutral" | "good"> = {
  missing_money: "danger",
  bad_math: "danger",
  to_confirm: "info",
  waiting: "neutral",
  rate_missing: "warning",
  all_good: "good",
};

export const POLICY_LABELS: Record<PolicyState, string> = { ok: "Right", short: "Short", over: "Over", no_promise: "No promise on file" };

/** Order on the Results list: what needs a call first. */
export const VERDICT_ORDER: PaymentVerdict[] = ["missing_money", "bad_math", "to_confirm", "rate_missing", "waiting", "all_good"];

const DAY = 86_400_000;
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string): number {
  // Both are UTC midnights, so the difference is a whole number of days.
  return Math.trunc((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY);
}

export type MoneyInput = {
  paidCents: number;
  confirmedCents: number;
  suggestedCents: number;
  statementDate: string;
  windowDays: number;
  toleranceCents: number;
  today: string;
  /** The latest date any imported bank line is on; null when no bank file has come in. */
  bankThrough: string | null;
};

/** Did the money land? Confirmed covers it → landed; a suggestion would → to confirm; past the window
 *  with the bank file reaching that far → missing; otherwise still waiting. */
export function moneyState(m: MoneyInput): { state: MoneyState; dueBy: string; missingCents: number } {
  const dueBy = addDays(m.statementDate, m.windowDays);
  const short = Math.max(0, m.paidCents - m.confirmedCents);
  if (short <= m.toleranceCents) return { state: "landed", dueBy, missingCents: 0 };
  if (m.confirmedCents + m.suggestedCents + m.toleranceCents >= m.paidCents) return { state: "to_confirm", dueBy, missingCents: 0 };
  if (m.today > dueBy && m.bankThrough !== null && m.bankThrough >= dueBy) return { state: "missing", dueBy, missingCents: short };
  return { state: "waiting", dueBy, missingCents: 0 };
}

export type PolicyInput = {
  /** An open or disputed LA-4.15 finding on this policy, if any. */
  finding: { type: "missing" | "short_paid" | "mis_rated" | "over_paid"; expectedCents: number | null; reportedCents: number | null; differenceCents: number | null } | null;
  /** The rate card's figure; null when there is no rate card for it. */
  expected: { rateBp: number | null; amountCents: number | null } | null;
};

export function policyState(p: PolicyInput): PolicyState {
  const f = p.finding;
  // Owed and not paid at all (LA-4.15 "missing"), or paid less: both are bad math.
  if (f?.type === "short_paid" || f?.type === "missing") return "short";
  // A wrong rate is bad math only when it paid less than promised; a higher rate is an overpayment.
  if (f?.type === "mis_rated") return f.expectedCents !== null && f.reportedCents !== null && f.reportedCents >= f.expectedCents ? "over" : "short";
  if (f?.type === "over_paid") return "over";
  if (!p.expected || p.expected.amountCents === null) return "no_promise";
  return "ok";
}

/** How much a short policy is short by (positive cents), from the finding's own figures. */
export function shortBy(p: PolicyInput): number {
  const f = p.finding;
  if (!f) return 0;
  // The finding's own difference (expected − paid), as the dispute letter claims it (disputeLetter.claimed), so the
  // page and the letter always show the same total; the figures are the fallback when it has none.
  if (f.differenceCents !== null) return Math.max(0, f.differenceCents);
  if (f.expectedCents !== null && f.reportedCents !== null) return Math.max(0, f.expectedCents - f.reportedCents);
  return f.type === "missing" && f.expectedCents !== null ? f.expectedCents : 0;
}

/** One verdict for the payment: missing money first, then bad math; a clean payment with a policy we
 *  cannot check is not "all good". */
export function paymentVerdict(money: MoneyState, policies: PolicyState[]): PaymentVerdict {
  if (money === "missing") return "missing_money";
  if (policies.includes("short")) return "bad_math";
  if (money === "to_confirm") return "to_confirm";
  if (money === "waiting") return "waiting";
  if (policies.includes("no_promise")) return "rate_missing";
  return "all_good";
}

export type ResultRow = { verdict: PaymentVerdict; paidCents: number; missingCents: number; shortCents: number };

/** The strip over the list: payments checked, all good, missing money, bad math. */
export function resultsSummary(rows: ResultRow[]) {
  const sum = (pick: (r: ResultRow) => number, only?: PaymentVerdict) => rows.filter((r) => !only || r.verdict === only).reduce((s, r) => s + pick(r), 0);
  return {
    checked: rows.length,
    checkedCents: sum((r) => r.paidCents),
    good: rows.filter((r) => r.verdict === "all_good").length,
    goodCents: sum((r) => r.paidCents, "all_good"),
    missing: rows.filter((r) => r.verdict === "missing_money").length,
    missingCents: sum((r) => r.missingCents, "missing_money"),
    badMath: rows.filter((r) => r.verdict === "bad_math").length,
    shortCents: sum((r) => r.shortCents, "bad_math"),
  };
}

/** "same day", "1 day after", "3 days after" — how long the bank took. */
export function lagWords(statementDate: string, postedOn: string): string {
  const d = daysBetween(statementDate, postedOn);
  if (d === 0) return "same day";
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} before`;
  return `${d} day${d === 1 ? "" : "s"} after`;
}

/** The nearest deposit for a payment nothing matched: same carrier window, closest amount. */
export function closestDeposit<T extends { postedOn: string; amountCents: number }>(deposits: T[], statementDate: string, paidCents: number, windowDays: number): T | null {
  const until = addDays(statementDate, windowDays + 7);
  const inRange = deposits.filter((d) => d.postedOn >= statementDate && d.postedOn <= until && d.amountCents > 0);
  inRange.sort((a, b) => Math.abs(a.amountCents - paidCents) - Math.abs(b.amountCents - paidCents) || a.postedOn.localeCompare(b.postedOn));
  return inRange[0] ?? null;
}

// ─── Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html § 1, direction B "Two questions") ──────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep 5, 2026" for an ISO day (a calendar day: no time zone moves it); anything else as given. */
export function readableDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "—";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
/** "Sep 5" for an ISO day. */
export function shortDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "—";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** The two questions' tabs: Payments (did the carrier pay right?), Deposits (is every bank line explained?), Accounts. */
export type BankTab = "payments" | "deposits" | "accounts";
/** The Payments chips. Waiting holds "deposit to confirm" and "waiting for the bank"; All holds every verdict. */
export const PAYMENT_FILTERS = ["all", "missing_money", "bad_math", "waiting", "all_good"] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];
/** The Deposits chips. */
export const DEPOSIT_FILTERS = ["to_match", "matched", "ignored", "all"] as const;
export type DepositFilter = (typeof DEPOSIT_FILTERS)[number];

/**
 * Where an address from before round 7 lands now, or null when it is already current: Results → Payments,
 * To match and Not explained → Deposits on To match (they were the same deposits in two states), Not received →
 * Payments on Missing money.
 */
export function legacyBankAddress(q: { view?: string; show?: string; period?: string }): string | null {
  const keep = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return `/app/bank?${p.toString()}`;
  };
  if (q.view === "results") return keep({ view: "payments", period: q.period, show: q.show });
  if (q.view === "queue" || q.view === "unexplained") return keep({ view: "deposits", show: "to_match" });
  if (q.view === "not_received") return keep({ view: "payments", period: q.period, show: "missing_money" });
  return null;
}

export function inPaymentFilter(verdict: PaymentVerdict, filter: PaymentFilter): boolean {
  if (filter === "all") return true;
  if (filter === "waiting") return verdict === "to_confirm" || verdict === "waiting";
  return verdict === filter;
}

/** The Payments list's order, worst first: missing money, bad math, then the rest; newest first within each. */
export function orderPayments<T extends { verdict: PaymentVerdict; statementDate: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.statementDate.localeCompare(a.statementDate) || a.id.localeCompare(b.id));
}

/** The Payments list's "Next step", in words: the step is taken on the payment's page, never in the row. */
export function paymentNextStep(r: { verdict: PaymentVerdict; carrierName: string; dueBy: string; shortPolicies: number }): string | null {
  if (r.verdict === "missing_money") return `Ask ${r.carrierName} where it went`;
  if (r.verdict === "bad_math") return `Review ${r.shortPolicies} short ${r.shortPolicies === 1 ? "policy" : "policies"}`;
  if (r.verdict === "to_confirm") return "Confirm the deposit";
  if (r.verdict === "waiting") return `Due in the bank by ${shortDay(r.dueBy)}`;
  if (r.verdict === "rate_missing") return "Add the rate to your rate card";
  return null;
}

/** Where a bank line stands on the Deposits tab. */
export function depositFilterOf(status: "unmatched" | "suggested" | "matched" | "partially_matched" | "ignored"): Exclude<DepositFilter, "all"> {
  if (status === "matched") return "matched";
  if (status === "ignored") return "ignored";
  return "to_match";
}

/** The Deposits list's "Next step", in words. */
export function depositNextStep(t: { status: "unmatched" | "suggested" | "matched" | "partially_matched" | "ignored"; pending: number }): string | null {
  if (t.status === "matched" || t.status === "ignored") return null;
  if (t.pending > 0) return t.pending === 1 ? "Confirm the match" : `Confirm ${t.pending} matches`;
  if (t.status === "partially_matched") return "Match the rest";
  return "Match it, or mark it not carrier money";
}

/** "$1,234.56" from whole cents, by string (no float). */
function dollars(cents: number): string {
  const d = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "-" : ""}$${Number(d.slice(0, -2)).toLocaleString("en-US")}.${d.slice(-2)}`;
}

/** A manual match's amount: whole cents, more than nothing, and never more than the deposit still has open. */
export function manualAmountProblem(amountCents: number | null, openCents: number): string | null {
  if (amountCents === null || amountCents <= 0) return "Enter the amount.";
  if (amountCents > openCents) return `More than the deposit (${dollars(openCents)}).`;
  return null;
}

/** The Payments list's own address (period and chip), handed to a payment page as `?from=` so its ‹ › walk the same list. */
export function paymentsFrom(period: string, filter: PaymentFilter): string {
  const p = new URLSearchParams({ period });
  if (filter !== "all") p.set("show", filter);
  return p.toString();
}
/** Read `?from=` back: the period and chip of the list a payment page was opened from (defaults: 90 days, All). */
export function readPaymentsFrom(from: string | undefined): { period: string; filter: PaymentFilter } {
  const p = new URLSearchParams(from ?? "");
  const period = ["30", "90", "365"].find((x) => x === p.get("period")) ?? "90";
  return { period, filter: PAYMENT_FILTERS.find((f) => f === p.get("show")) ?? "all" };
}
/** A payment page's address, carrying the list it was opened from. */
export const paymentHref = (id: string, from: string, extra = "") => `/app/bank/payments/${id}?from=${encodeURIComponent(from)}${extra}`;
