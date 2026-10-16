/**
 * LA-4.16 (Notion sprint) · the retention board, as plain functions: why each policy is on it, how
 * many days are left, the order to call in, and — from logged calls marked by the next file — the
 * save rate. Everything here is read from the carrier's files and rules; nothing is a prediction.
 *
 * Pure; integer cents.
 */

export const REASONS = ["cancellation_request", "conservation", "bounced_draft", "first_payment_missed", "later_payment_missed", "recently_lapsed", "direct_bill"] as const;
export type Reason = (typeof REASONS)[number];

export const REASON_LABELS: Record<Reason, string> = {
  cancellation_request: "Asked to cancel",
  conservation: "Carrier conservation notice",
  bounced_draft: "Draft bounced",
  first_payment_missed: "First payment missed",
  later_payment_missed: "Payment missed",
  recently_lapsed: "Lapsed, can still be reinstated",
  direct_bill: "Mailed bill: convert to bank draft",
};

export const OUTCOMES = ["promised_to_pay", "refused", "voicemail", "wrong_number", "already_paid", "converting_to_draft"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  promised_to_pay: "Reached, promised to pay",
  refused: "Reached, refused",
  voicemail: "Left voicemail",
  wrong_number: "Wrong number",
  already_paid: "Already paid",
  converting_to_draft: "Converting to bank draft",
};

export type BoardPolicy = {
  carrierId: string;
  policyNumber: string;
  status: string | null;
  statusReported: string | null;
  statusRaw: string | null;
  paidTo: string | null;
  effectiveDate: string | null;
  daysPastDue: number | null;
  daysUntilClose: number | null;
  graceDays: number | null;
  lapsedOn: string | null;
  paymentMethod: string | null;
  /** The latest paid-to change on file (LA-4.6). */
  lastPaidToChange: { from: string | null; to: string | null; on: string } | null;
  /** The carrier's reinstatement window, if configured (LA-4.17). */
  reinstatementDays: number | null;
  /** The date of the latest carrier file for this policy. */
  lastSnapshotDate: string | null;
  /**
   * A cancellation request or a conservation notice runs on its own carrier window (LA-4.17), counted
   * from the file that first showed the carrier's current word. Null: no window, or not such a row.
   */
  noticeWindowDays?: number | null;
  noticeSince?: string | null;
  /**
   * The carrier's first-payment window (LA-4.17), when the policy's rule is one. A first payment
   * missed counts down on it from the effective date even where policy_current has no countdown yet
   * (an approved policy before 20261015520000 gave it one).
   */
  firstPaymentWindowDays?: number | null;
};

const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
const daysSince = (iso: string, today: string) => dayNumber(today) - dayNumber(iso);

const BOUNCE = /\b(returned|return item|ret item|nsf|insufficient|bounced|draft (failed|rejected))\b/i;
const CANCEL = /(cancel\w*\s+request|request\w*\s+(cancel|termination)|surrender request|free\s?look)/i;
const IN_FORCE = new Set(["active", "at_risk", "approved_unpaid"]);

/**
 * The reason a policy is on the board, or null. One reason per row, the most urgent first:
 * a request to cancel and a carrier's own notice outrank a missed draft, which outranks prevention.
 */
export function reasonFor(p: BoardPolicy, today: string): Reason | null {
  const status = p.status ?? "";
  const grace = p.graceDays ?? 0;
  if (CANCEL.test(p.statusRaw ?? "") && !["lapsed", "not_taken", "declined", "withdrawn"].includes(status)) return "cancellation_request";
  if (p.statusReported === "at_risk") return "conservation";
  const backwards = p.lastPaidToChange && p.lastPaidToChange.from && p.lastPaidToChange.to && p.lastPaidToChange.to < p.lastPaidToChange.from && p.lastPaidToChange.on === p.lastSnapshotDate;
  if (IN_FORCE.has(status) && (backwards || BOUNCE.test(p.statusRaw ?? ""))) return "bounced_draft";
  const neverPaid = !p.paidTo || (p.effectiveDate !== null && p.paidTo <= p.effectiveDate);
  if (IN_FORCE.has(status) && neverPaid && p.effectiveDate && p.effectiveDate < today) {
    const late = p.daysPastDue ?? daysSince(p.effectiveDate, today);
    if (late > grace) return "first_payment_missed";
  }
  if ((status === "active" || status === "at_risk") && !neverPaid && (p.daysPastDue ?? 0) > grace) return "later_payment_missed";
  if (status === "lapsed" && p.lapsedOn) {
    const since = daysSince(p.lapsedOn, today);
    // With no reinstatement window configured nothing is invented: only a lapse the latest file
    // brought is listed (in the "no carrier window configured" group).
    if (p.reinstatementDays !== null ? since <= p.reinstatementDays : p.lapsedOn === p.lastSnapshotDate) return "recently_lapsed";
  }
  if (status === "active" && p.paymentMethod === "direct_bill") return "direct_bill";
  return null;
}

/** Days left to act: the carrier's window from LA-4.7, the reinstatement window for a lapse, none for prevention. */
export function daysLeftFor(p: BoardPolicy, reason: Reason, today: string): number | null {
  if (reason === "direct_bill") return null;
  if (reason === "recently_lapsed") return p.lapsedOn && p.reinstatementDays !== null ? Math.max(0, p.reinstatementDays - daysSince(p.lapsedOn, today)) : null;
  if ((reason === "cancellation_request" || reason === "conservation") && p.noticeWindowDays != null && p.noticeSince) return Math.max(0, p.noticeWindowDays - daysSince(p.noticeSince, today));
  if (p.daysUntilClose !== null) return Math.max(0, p.daysUntilClose);
  if (reason === "first_payment_missed" && p.firstPaymentWindowDays != null && p.effectiveDate) return Math.max(0, p.firstPaymentWindowDays - (p.daysPastDue ?? Math.max(0, daysSince(p.effectiveDate, today))));
  return null;
}

export type Group = "deadline" | "no_window" | "prevention";
export const GROUP_LABELS: Record<Group, string> = { deadline: "Before the carrier closes it", no_window: "No carrier window configured", prevention: "Prevention" };

export type BoardRow = { key: string; reason: Reason; daysLeft: number | null; atRiskCents: number | null; group: Group };

/** Soonest deadline first; among equal deadlines, the most money first. Unwindowed rows below, labelled; prevention last. */
export function boardOrder<T extends BoardRow>(rows: T[]): T[] {
  const order: Group[] = ["deadline", "no_window", "prevention"];
  return [...rows].sort((a, b) =>
    order.indexOf(a.group) - order.indexOf(b.group)
    || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)
    || (b.atRiskCents ?? -1) - (a.atRiskCents ?? -1)
    || a.key.localeCompare(b.key));
}

export const groupOf = (reason: Reason, daysLeft: number | null): Group => (reason === "direct_bill" ? "prevention" : daysLeft === null ? "no_window" : "deadline");

/** How urgent the countdown reads. */
export const urgency = (daysLeft: number | null): "red" | "amber" | "plain" => (daysLeft === null ? "plain" : daysLeft <= 3 ? "red" : daysLeft <= 7 ? "amber" : "plain");

export type ResultedAction = { reason: string; carrierId: string; actedBy: string | null; result: string | null };

/** Save rate = saved ÷ (saved + lost), by whatever key; still-at-risk calls are counted but not yet in the rate. */
export function saveRates(actions: ResultedAction[], key: (a: ResultedAction) => string) {
  const out = new Map<string, { saved: number; lost: number; open: number; rate: number | null }>();
  for (const a of actions) {
    const k = key(a);
    const entry = out.get(k) ?? { saved: 0, lost: 0, open: 0, rate: null };
    if (a.result === "saved") entry.saved++;
    else if (a.result === "lost") entry.lost++;
    else entry.open++;
    out.set(k, entry);
  }
  for (const entry of out.values()) entry.rate = entry.saved + entry.lost ? Math.floor((entry.saved * 100) / (entry.saved + entry.lost)) : null;
  return out;
}
