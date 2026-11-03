/**
 * LA-5.6 (Notion sprint) · reinstatement, as plain rules: the steps a person takes, the countdown
 * and its colours, the estimate of what is owed (always labelled an estimate), and the
 * reinstate-versus-sell-new comparison that turns a list into a decision.
 *
 * Opening a case, "reinstated" and "expired" are never decided here: sync_reinstatement_cases decides
 * them from the carrier's files and the calendar.
 *
 * Pure; relative imports only.
 */

import type { RetentionSettings } from "./constants.ts";

export const CASE_STATUSES = ["identified", "contacted", "client_agreed", "submitted", "reinstated", "declined_by_client", "declined_by_carrier", "expired"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  identified: "Not called yet",
  contacted: "Spoken to",
  client_agreed: "Client agreed",
  submitted: "Sent to the carrier",
  reinstated: "Reinstated",
  declined_by_client: "Client said no",
  declined_by_carrier: "Carrier said no",
  expired: "Window closed",
};
export const OPEN_CASE_STATUSES: readonly CaseStatus[] = ["identified", "contacted", "client_agreed", "submitted"];
/** The forward steps a person takes. Reinstated and expired are the files' and the calendar's. */
export const FORWARD: readonly CaseStatus[] = ["identified", "contacted", "client_agreed", "submitted"];
export const DECLINES = ["declined_by_client", "declined_by_carrier"] as const;

export function canMove(from: CaseStatus, to: CaseStatus): boolean {
  if (!OPEN_CASE_STATUSES.includes(from)) return false;
  if ((DECLINES as readonly string[]).includes(to)) return true;
  const a = FORWARD.indexOf(from);
  const b = FORWARD.indexOf(to);
  return b > a;
}

const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

export const daysRemaining = (deadline: string | null, today: string): number | null => (deadline ? dayNumber(deadline) - dayNumber(today) : null);

export type Urgency = "pinned" | "red" | "amber" | "plain" | "no_window";

/** Amber inside 14 days, red inside 7, pinned to the top inside 3 (all configurable). No window: its own group. */
export function urgencyOf(days: number | null, s: Pick<RetentionSettings, "reinstatementAmberDays" | "reinstatementRedDays" | "reinstatementPinDays">): Urgency {
  if (days === null) return "no_window";
  if (days <= s.reinstatementPinDays) return "pinned";
  if (days <= s.reinstatementRedDays) return "red";
  if (days <= s.reinstatementAmberDays) return "amber";
  return "plain";
}

/** Fewest days first; equal days, the most advance first; no configured window last, in its own labelled group. */
export function caseOrder<T extends { key: string; daysRemaining: number | null; advanceCents: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    (a.daysRemaining === null ? 1 : 0) - (b.daysRemaining === null ? 1 : 0)
    || (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0)
    || (b.advanceCents ?? -1) - (a.advanceCents ?? -1)
    || a.key.localeCompare(b.key));
}

/**
 * What the client probably owes: the months between the paid-to date and today, times the monthly
 * premium. The carrier decides the real figure (missed months, late fees, whether the advance was
 * clawed back), so this is only ever shown as an estimate — a number to open the conversation with.
 */
export function estimateOwed(paidTo: string | null, today: string, monthlyPremiumCents: number | null): { months: number; cents: number } | null {
  if (!paidTo || monthlyPremiumCents === null || monthlyPremiumCents <= 0) return null;
  const gap = dayNumber(today) - dayNumber(paidTo);
  if (gap <= 0) return null;
  const months = Math.max(1, Math.ceil(gap / 30.44));
  return { months, cents: months * monthlyPremiumCents };
}

/** Whole years of age on a date. */
export function ageOn(dob: string | null, on: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  let age = +on.slice(0, 4) - +dob.slice(0, 4);
  if (on.slice(5, 10) < dob.slice(5, 10)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export type Comparison = {
  reinstate: { owedCents: number | null; owedIsEstimate: boolean; months: number | null; advanceRevivesCents: number | null; needsHealthQuestions: boolean | null };
  sellNew: { ageThen: number | null; ageNow: number | null; olderNow: boolean };
};

/**
 * Side by side. Reinstating revives the original advance (no new chargeback window) and keeps the
 * issue age; a new policy prices at today's age and starts a fresh twelve-month risk. We hold no age
 * rate tables, so the new premium is not invented: the age difference is shown, and the agent quotes it.
 */
export function compare(input: {
  enteredOwedCents: number | null; enteredMonths: number | null; estimate: { months: number; cents: number } | null;
  advanceCents: number | null; needsHealthQuestions: boolean | null; dob: string | null; issuedOn: string | null; today: string;
}): Comparison {
  const entered = input.enteredOwedCents !== null;
  const ageThen = input.issuedOn ? ageOn(input.dob, input.issuedOn) : null;
  const ageNow = ageOn(input.dob, input.today);
  return {
    reinstate: {
      owedCents: entered ? input.enteredOwedCents : input.estimate?.cents ?? null,
      owedIsEstimate: !entered,
      months: entered ? input.enteredMonths : input.estimate?.months ?? null,
      advanceRevivesCents: input.advanceCents,
      needsHealthQuestions: input.needsHealthQuestions,
    },
    sellNew: { ageThen, ageNow, olderNow: ageThen !== null && ageNow !== null && ageNow > ageThen },
  };
}
