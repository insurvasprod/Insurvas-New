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
