/**
 * The Retention ladder (owner 2026-11-05, docs/retention/SPEC.md), as plain rules. Every case comes from
 * the uploaded policy and commission files: the fact the files show (the reason) puts a policy at its risk
 * point (the step), with a deadline only the carrier's rules and dates give, and one next action.
 *
 *   payment_problem → pending_lapse → lapsed_reinstatable → lost      (paperwork sits beside the ladder)
 *
 * It builds on LA-4.16's `reasonFor()` (lib/ingestion/retentionBoard.ts) rather than repeating it. Pure.
 */
import type { Reason as BoardReason } from "../../ingestion/retentionBoard.ts";

export const STEPS = ["payment_problem", "pending_lapse", "lapsed_reinstatable", "lost", "paperwork"] as const;
export type Step = (typeof STEPS)[number];
export const LADDER_STEPS: readonly Step[] = ["payment_problem", "pending_lapse", "lapsed_reinstatable", "lost"];
export const STEP_LABELS: Record<Step, string> = {
  payment_problem: "Payment problem",
  pending_lapse: "Pending lapse",
  lapsed_reinstatable: "Lapsed, can reinstate",
  lost: "Lost",
  paperwork: "Paperwork",
};
/** The step in an address (`/app/retention?step=lapse`), both ways. */
export const STEP_SLUG: Record<Step, string> = { payment_problem: "payment", pending_lapse: "lapse", lapsed_reinstatable: "lapsed", lost: "lost", paperwork: "paperwork" };
export const stepFromSlug = (slug: string | null | undefined): Step | null => (Object.keys(STEP_SLUG) as Step[]).find((s) => STEP_SLUG[s] === slug) ?? null;
/** 1–4 on the ladder; paperwork is not on it. */
export const stepNumber = (step: Step): number | null => (step === "paperwork" ? null : LADDER_STEPS.indexOf(step) + 1);

export const REASONS = [
  "first_draft_failed", "later_draft_failed", "bounced_draft", "banking_problem",
  "pending_lapse", "lapse_notice", "lapsed_reinstatable", "lapsed_lost", "chargeback",
  "cancellation_request", "pending_manual_action", "payment_date_change", "mailed_bill",
] as const;
export type Reason = (typeof REASONS)[number];
export const REASON_LABELS: Record<Reason, string> = {
  // The files show the first payment missing, not why: it may be a mailed bill, never a draft.
  first_draft_failed: "First payment missed",
  later_draft_failed: "Payment missed",
  bounced_draft: "Draft bounced",
  banking_problem: "Banking problem",
  pending_lapse: "Carrier says lapse pending",
  lapse_notice: "Lapse notice",
  lapsed_reinstatable: "Lapsed, inside the reinstatement window",
  lapsed_lost: "Lapsed past the window",
  chargeback: "Charged back",
  cancellation_request: "Asked to cancel",
  pending_manual_action: "Pending manual action",
  payment_date_change: "Wants a new payment date",
  mailed_bill: "Paying by mailed bill",
};
/** The step each reason belongs to, before a near deadline moves a payment problem up. */
export const REASON_STEP: Record<Reason, Step> = {
  first_draft_failed: "payment_problem", later_draft_failed: "payment_problem", bounced_draft: "payment_problem", banking_problem: "payment_problem",
  pending_lapse: "pending_lapse", lapse_notice: "pending_lapse",
  lapsed_reinstatable: "lapsed_reinstatable",
  lapsed_lost: "lost", chargeback: "lost",
  cancellation_request: "paperwork", pending_manual_action: "paperwork", payment_date_change: "paperwork", mailed_bill: "paperwork",
};
/** The one next action a row offers (the case page's primary button). */
export const NEXT_ACTION: Record<Reason, string> = {
  // One verb per step that the case page repeats (critique B3: "Call: First Payment", "Close · To Win-Back").
  first_draft_failed: "Get the first payment",
  later_draft_failed: "Take the payment",
  bounced_draft: "Fix the draft",
  banking_problem: "Fix the bank",
  pending_lapse: "Take the payment",
  lapse_notice: "Take the payment",
  lapsed_reinstatable: "Reinstate",
  lapsed_lost: "Close to win-back",
  chargeback: "Close to win-back",
  cancellation_request: "Keep the policy",
  pending_manual_action: "Open the checklist",
  payment_date_change: "Change the date",
  mailed_bill: "Switch to bank draft",
};

/** 1 high · 2 medium · 3 depends (the ChatGPT write-up's priorities). */
export function priorityOf(reason: Reason, step: Step): 1 | 2 | 3 {
  if (step === "pending_lapse" || step === "lapsed_reinstatable" || reason === "first_draft_failed" || reason === "cancellation_request") return 1;
  if (step === "payment_problem" || step === "lost") return 2;
  return 3;
}

/** A carrier's own status word, flagged in the status map (20261105200000). */
export type StatusFlag = "banking" | "notice" | "manual_action" | "cancellation" | "pending_lapse";

export type LadderSettings = {
  /** Reasons switched off by the agency (Settings › Retention › Ladder rules). */
  disabled: ReadonlySet<Reason>;
  /** A payment problem whose deadline is this close moves up to Pending lapse. */
  urgentDays: number;
  /** Failed contact attempts before a case is badged Unreachable. */
  unreachableAfter: number;
};
export const DEFAULT_LADDER_SETTINGS: LadderSettings = { disabled: new Set(), urgentDays: 7, unreachableAfter: 4 };

export type Placement = { step: Step; reason: Reason; deadline: string | null; priority: 1 | 2 | 3 };

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const FROM_BOARD: Record<BoardReason, Reason> = {
  first_payment_missed: "first_draft_failed",
  later_payment_missed: "later_draft_failed",
  bounced_draft: "bounced_draft",
  conservation: "pending_lapse",
  recently_lapsed: "lapsed_reinstatable",
  cancellation_request: "cancellation_request",
  direct_bill: "mailed_bill",
};
/** A flagged carrier word → the reason it gives (also shown on Settings › Ladder rules). */
export const FROM_FLAG: Record<StatusFlag, Reason> = {
  banking: "banking_problem",
  notice: "lapse_notice",
  pending_lapse: "pending_lapse",
  manual_action: "pending_manual_action",
  cancellation: "cancellation_request",
};

/**
 * Where the files put one policy on the ladder now, and the paperwork beside it. `boardReason` is LA-4.16's
 * reason (null: none), `daysLeft` its carrier countdown (null: no window — the deadline stays empty, never
 * guessed), `flag` the carrier word's flag. A switched-off reason places nothing.
 */
export function placeOnLadder(input: { boardReason: BoardReason | null; daysLeft: number | null; flag: StatusFlag | null }, today: string, settings: LadderSettings = DEFAULT_LADDER_SETTINGS): { ladder: Placement | null; paperwork: Placement[] } {
  const found: Reason[] = [];
  if (input.boardReason) found.push(FROM_BOARD[input.boardReason]);
  if (input.flag) found.push(FROM_FLAG[input.flag]);
  // A deadline already passed stays on its real day (walk 2026-11-05: clamping it to today showed 333 overdue
  // cases as "Today" and moved their date every day). The list then says how many days over it is.
  const deadline = input.daysLeft === null ? null : addDays(today, input.daysLeft);
  const place = (reason: Reason): Placement => {
    let step = REASON_STEP[reason];
    // A payment problem about to run out of time is a pending lapse: the agent must act now.
    if (step === "payment_problem" && input.daysLeft !== null && input.daysLeft <= settings.urgentDays) step = "pending_lapse";
    return { step, reason, deadline, priority: priorityOf(reason, step) };
  };
  const enabled = [...new Set(found)].filter((r) => !settings.disabled.has(r)).map(place);
  const ladderOnes = enabled.filter((p) => p.step !== "paperwork");
  // The highest risk point wins (the policy sits on one step); a tie keeps the board's own reason.
  const ladder = ladderOnes.sort((a, b) => (stepNumber(b.step) ?? 0) - (stepNumber(a.step) ?? 0))[0] ?? null;
  return { ladder, paperwork: enabled.filter((p) => p.step === "paperwork") };
}

export const OPEN_STATUSES = ["open", "working", "waiting_on_carrier"] as const;
/** How long a closed case stays on the Cases page's Closed tab. */
export const CLOSED_DAYS = 90;
export type CaseStatus = "open" | "working" | "waiting_on_carrier" | "saved" | "lost" | "closed_no_save";
export const STATUS_LABELS: Record<CaseStatus, string> = {
  open: "Not started", working: "Working", waiting_on_carrier: "With the carrier", saved: "Saved", lost: "Lost", closed_no_save: "Closed without a save",
};

/** `byPerson`: opened by a person (New case, round 7: what a person heard before any file shows it). */
export type OpenCase = { id: string; step: Step; reason: Reason; deadline: string | null; status: CaseStatus; byPerson?: boolean };
/** The reasons a person may open a case for (round 7, Lapse risk 4·A: a recorded signal is a case). */
export const PERSON_REASONS = ["cancellation_request", "payment_date_change", "pending_manual_action"] as const satisfies readonly Reason[];
export type PersonReason = (typeof PERSON_REASONS)[number];
export type PolicyNow = { status: string | null; paidTo: string | null };

export type Transition =
  | { kind: "keep" }
  | { kind: "move"; to: Placement }
  | { kind: "refresh"; to: Placement }
  | { kind: "save" }
  | { kind: "lose"; reason: Reason };

const IN_FORCE = new Set(["active", "at_risk", "approved_unpaid", "paid_up"]);
const GONE = new Set(["lapsed", "not_taken", "declined", "withdrawn"]);

/**
 * What the newest files do to an open LADDER case. A case leaves as saved only when the files say so: the
 * policy is placed nowhere and is in force (paid again). It moves up when placed higher, never down (a
 * pending lapse does not drop back to a payment problem while it is still being worked). It becomes lost when
 * the policy is gone and no longer reinstatable.
 */
export function ladderTransition(open: OpenCase, now: Placement | null, policy: PolicyNow): Transition {
  if (now) {
    const from = stepNumber(open.step) ?? 0;
    const at = stepNumber(now.step) ?? 0;
    if (at > from) return { kind: "move", to: now };
    const step = at < from ? open.step : now.step;
    if (now.deadline !== open.deadline || now.reason !== open.reason) return { kind: "refresh", to: { ...now, step, priority: priorityOf(now.reason, step) } };
    return { kind: "keep" };
  }
  if (open.step === "lost") return { kind: "keep" };
  if (policy.status && GONE.has(policy.status)) return { kind: "lose", reason: "lapsed_lost" };
  if (policy.status && IN_FORCE.has(policy.status)) return { kind: "save" };
  return { kind: "keep" };
}

/**
 * A chargeback line puts a policy on step 4 only when the policy file shows it gone. A chargeback on a policy
 * the file shows in force and paid ahead was recovered (or reversed): not a retention case (dry run on the
 * demo's American Amicable book, 2026-11-05: two such policies were wrongly "lost").
 */
export const chargebackMeansLost = (policyStatus: string | null): boolean => Boolean(policyStatus && GONE.has(policyStatus));

/** A paperwork case clears when the files no longer show its reason; it is lost if the policy is gone. */
export function paperworkTransition(open: OpenCase, stillThere: boolean, policy: PolicyNow): Transition {
  // A case a person opened is not one the files carry: their absence proves nothing. It stays until a person
  // closes it, or the policy is gone.
  if (stillThere || open.reason === "payment_date_change" || (open.byPerson && !(policy.status && GONE.has(policy.status)))) return { kind: "keep" };
  if (policy.status && GONE.has(policy.status)) return { kind: "lose", reason: open.reason };
  return { kind: "save" };
}

/** Days left on a case's deadline (negative: past it), or null with no deadline. */
export const daysUntil = (deadline: string | null, today: string): number | null =>
  deadline ? Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;

/** The order the agent works in: highest step first, then the nearest deadline, then the most premium. */
export function caseOrder<T extends { step: Step; deadline: string | null; premiumCents: number | null }>(rows: T[]): T[] {
  const rank = (s: Step) => (s === "paperwork" ? 0 : (stepNumber(s) ?? 0) === 4 ? 0.5 : stepNumber(s) ?? 0);
  return [...rows].sort((a, b) => rank(b.step) - rank(a.step) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || (b.premiumCents ?? -1) - (a.premiumCents ?? -1));
}
