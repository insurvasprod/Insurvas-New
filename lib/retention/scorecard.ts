/**
 * LA-5.8 (Notion sprint) · the retention scorecard, as plain functions — fair, because people are
 * paid on it.
 *
 *   1. Save rate is always broken down by the reason worked. A blended figure exists only as the
 *      total row of that breakdown, never on its own.
 *   2. Under 10 cases in a bucket the count is shown, not a percentage ("3 of 5", not 60%).
 *   3. Holdout cases are excluded from every metric (not working a policy on purpose never counts).
 *   4. Unreachable is not unsuccessful: a case where nobody was ever reached is a data problem, shown
 *      on its own, and is outside the save rate.
 *   5. Premium and advance protected count only policies still in force 90 days after being worked.
 *
 * A case is one person working one policy for one reason in the period. The reason is what the client
 * said when they refused (can't afford it / don't want it), else the card's first recommended fix
 * when it was worked; a paper-bill campaign call is a paper-bill case.
 *
 * Pure; relative imports only.
 */

import type { ClientReason, ContactOutcome } from "./constants.ts";

export const SAVE_REASONS = ["draft_timing", "paper_bill", "payment_details", "affordability", "no_longer_wanted", "other"] as const;
export type SaveReason = (typeof SAVE_REASONS)[number];
export const SAVE_REASON_LABELS: Record<SaveReason, string> = {
  draft_timing: "Draft timing problem",
  paper_bill: "Paper bill conversion",
  payment_details: "Card or bank details",
  affordability: "Can't afford it",
  no_longer_wanted: "Doesn't want it any more",
  other: "No clear cause (courtesy call)",
};

export const SCORECARD_PERIODS = { "90": 90, "180": 182, "365": 365 } as const;
export type ScorecardPeriod = keyof typeof SCORECARD_PERIODS;
export const SCORECARD_PERIOD_LABELS: Record<ScorecardPeriod, string> = { "90": "Last 90 days", "180": "Last 6 months", "365": "Last 12 months" };

/** Below this many decided cases, a reason's save rate is shown as a count. */
export const MIN_SAVE_SAMPLE = 10;
/** Days a worked policy must stay in force to count as saved, and as protected. */
export const SAVED_AFTER_DAYS = 90;

const REACHED_SAVE: ReadonlySet<ContactOutcome> = new Set(["reached_agreed", "reached_refused", "already_fixed"] as ContactOutcome[]);
const REACHED_CONVERSION = new Set(["converted", "declined", "callback_requested", "unable_no_bank_account"]);

const ACTION_REASON: Record<string, SaveReason> = {
  move_draft_date: "draft_timing",
  convert_to_draft: "paper_bill",
  confirm_card_funded: "payment_details",
  confirm_account: "payment_details",
  review_coverage: "affordability",
  courtesy_call: "other",
};

export type SaveAttemptIn = {
  by: string | null;
  key: string;
  at: string;
  outcome: ContactOutcome;
  firstAction: string | null;
  clientReason: ClientReason | null;
  advanceCents: number | null;
  inHoldout: boolean;
};
export type ConversionIn = { by: string | null; key: string; at: string; outcome: string; verified: boolean };
export type ReinstatedIn = { by: string | null; key: string; at: string };
export type PolicyIn = { status: string | null; lapsedOn: string | null; annualCents: number | null };

export function reasonOf(a: Pick<SaveAttemptIn, "clientReason" | "firstAction">): SaveReason {
  if (a.clientReason) return a.clientReason;
  return (a.firstAction && ACTION_REASON[a.firstAction]) || "other";
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type CaseResult = "saved" | "lost" | "pending";

/** In force 90 days after it was worked → saved; lapsed inside that → lost; too soon to say → pending. */
export function resultOf(p: PolicyIn | undefined, workedOn: string, today: string): CaseResult {
  const horizon = addDays(workedOn, SAVED_AFTER_DAYS);
  if (!p) return "pending";
  const ended = p.status === "lapsed" || p.status === "not_taken" || p.status === "withdrawn";
  if (ended && (!p.lapsedOn || p.lapsedOn <= horizon)) return "lost";
  if (horizon > today) return "pending";
  return "saved";
}

export type ReasonLine = { reason: SaveReason | "all"; cases: number; unreachable: number; reached: number; saved: number; lost: number; pending: number; rate: number | null };

export type RepCard = {
  userId: string;
  policiesWorked: number;
  attempts: number;
  reached: number;
  /** Reached ÷ attempted; null with no attempts. */
  contactRate: number | null;
  byReason: ReasonLine[];
  /** The breakdown's total row. Never rendered without `byReason`. */
  blended: ReasonLine;
  conversions: number;
  reinstatements: number;
  premiumProtectedCents: number;
  advanceProtectedCents: number;
};

export function scorecards(input: {
  attempts: SaveAttemptIn[];
  conversions: ConversionIn[];
  reinstated: ReinstatedIn[];
  policies: Map<string, PolicyIn>;
  /** Policies held out at any point in the period. */
  holdoutKeys: Set<string>;
  from: string;
  to: string;
  today: string;
}): RepCard[] {
  const inPeriod = (at: string) => at.slice(0, 10) >= input.from && at.slice(0, 10) <= input.to;
  const saves = input.attempts.filter((a) => a.by && inPeriod(a.at) && !a.inHoldout && !input.holdoutKeys.has(a.key));
  const calls = input.conversions.filter((c) => c.by && inPeriod(c.at) && !input.holdoutKeys.has(c.key));
  const people = new Set<string>([...saves.map((a) => a.by!), ...calls.map((c) => c.by!), ...input.reinstated.filter((r) => r.by && inPeriod(r.at) && !input.holdoutKeys.has(r.key)).map((r) => r.by!)]);

  return [...people].sort().map((userId) => {
    const mineS = saves.filter((a) => a.by === userId).sort((a, b) => a.at.localeCompare(b.at));
    const mineC = calls.filter((c) => c.by === userId).sort((a, b) => a.at.localeCompare(b.at));

    // Cases: (policy, reason), first worked at the earliest attempt; reached if any call reached them.
    type Case = { key: string; reason: SaveReason; workedOn: string; reached: boolean; advanceCents: number | null };
    const cases = new Map<string, Case>();
    const policyReason = new Map<string, SaveReason>();
    for (const a of mineS) {
      // A later refusal with a stated reason re-labels the policy's case: that is what it was.
      if (a.clientReason) policyReason.set(a.key, a.clientReason);
      else if (!policyReason.has(a.key)) policyReason.set(a.key, reasonOf(a));
    }
    for (const a of mineS) {
      const reason = policyReason.get(a.key)!;
      const id = `${a.key}#${reason}`;
      const c = cases.get(id) ?? { key: a.key, reason, workedOn: a.at, reached: false, advanceCents: a.advanceCents };
      c.reached ||= REACHED_SAVE.has(a.outcome);
      cases.set(id, c);
    }
    for (const call of mineC) {
      const id = `${call.key}#paper_bill`;
      const c = cases.get(id) ?? { key: call.key, reason: "paper_bill" as SaveReason, workedOn: call.at, reached: false, advanceCents: null };
      c.reached ||= REACHED_CONVERSION.has(call.outcome);
      cases.set(id, c);
    }

    const line = (reason: SaveReason | "all", list: Case[]): ReasonLine => {
      const reached = list.filter((c) => c.reached);
      const results = reached.map((c) => resultOf(input.policies.get(c.key), c.workedOn, input.today));
      const saved = results.filter((r) => r === "saved").length;
      const lost = results.filter((r) => r === "lost").length;
      const decided = saved + lost;
      return { reason, cases: list.length, unreachable: list.length - reached.length, reached: reached.length, saved, lost, pending: reached.length - decided, rate: decided >= MIN_SAVE_SAMPLE ? saved / decided : null };
    };
    const all = [...cases.values()];
    const byReason = SAVE_REASONS.map((r) => line(r, all.filter((c) => c.reason === r))).filter((l) => l.cases > 0);

    // Protected: each policy once (its first case), only when saved — in force 90 days after being worked.
    const firstCase = new Map<string, Case>();
    for (const c of all) if (!firstCase.has(c.key) || c.workedOn < firstCase.get(c.key)!.workedOn) firstCase.set(c.key, c);
    let premium = 0;
    let advance = 0;
    for (const c of firstCase.values()) {
      if (!c.reached || resultOf(input.policies.get(c.key), c.workedOn, input.today) !== "saved") continue;
      premium += input.policies.get(c.key)?.annualCents ?? 0;
      advance += c.advanceCents ?? 0;
    }
    const attempts = mineS.length + mineC.length;
    const reached = mineS.filter((a) => REACHED_SAVE.has(a.outcome)).length + mineC.filter((c) => REACHED_CONVERSION.has(c.outcome)).length;
    return {
      userId,
      policiesWorked: new Set(all.map((c) => c.key)).size,
      attempts,
      reached,
      contactRate: attempts ? reached / attempts : null,
      byReason,
      blended: line("all", all),
      conversions: mineC.filter((c) => c.outcome === "converted" && c.verified).length,
      reinstatements: input.reinstated.filter((r) => r.by === userId && inPeriod(r.at) && !input.holdoutKeys.has(r.key)).length,
      premiumProtectedCents: premium,
      advanceProtectedCents: advance,
    };
  });
}

/** The words for a save-rate cell: a percentage with enough decided cases, else the counts. */
export function rateText(l: Pick<ReasonLine, "saved" | "lost" | "rate">): string {
  const decided = l.saved + l.lost;
  if (!decided) return "None decided yet";
  if (l.rate === null) return `${l.saved} of ${decided} saved`;
  return `${Math.round(l.rate * 100)}%`;
}

/** Who may see whose card: the owner every card, anyone else their own only. */
export const visibleCards = <T extends { userId: string }>(cards: T[], viewer: { userId: string; role: string }) =>
  viewer.role === "owner" ? cards : cards.filter((c) => c.userId === viewer.userId);
