/**
 * Book of business › Setup › Pipeline rules (owner 2026-11-02, docs/la4/SIMPLIFY-PROPOSAL.md §4, §7):
 * the vocabulary. When something happens to a policy, move its lead's card and add a note. No AI —
 * every event is a fact the code computes (events.ts), every check is code (plan.ts).
 *
 * A rule is: an event, the carriers (none = every carrier), the stages it may move a card from (none =
 * any stage), the pipeline and stage it moves to, and a note with fill-ins. A rule is draft, forecast
 * or live; owner decision 3: it starts in forecast and records "would move" until switched to live.
 *
 * Pure; relative imports only (unit-tested with node --experimental-strip-types).
 */

export const RULE_EVENTS = [
  "issued",
  "waiting_first_payment",
  "first_payment_missed",
  "later_payment_missed",
  "paid_again",
  "lapsed",
  "not_taken",
  "cancelled",
  "declined",
  "withdrawn",
  "advance_received",
  "commission_credited",
  "chargeback_received",
] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];

/** Each event in the words the pages use, and what makes it happen (the Rule tab says it under the picker). */
export const EVENT_LABELS: Record<RuleEvent, { label: string; meaning: string }> = {
  issued: { label: "Issued", meaning: "The carrier's file shows the policy issued (its first day issued)." },
  waiting_first_payment: { label: "Waiting for first payment", meaning: "Approved, and the first premium has not been drawn yet." },
  first_payment_missed: { label: "First payment missed", meaning: "Missed means: issued, and the first premium is late by more than the carrier's first-payment grace (Carrier rules). Checked every morning, even when no file arrives." },
  later_payment_missed: { label: "Later payment missed", meaning: "A paying policy whose paid-to date is behind by more than the carrier's grace after a missed payment (Carrier rules). Checked every morning, even when no file arrives." },
  paid_again: { label: "Paid again", meaning: "The paid-to date moved forward after a missed payment." },
  lapsed: { label: "Lapsed", meaning: "The carrier's file changes the policy to lapsed." },
  not_taken: { label: "Not taken", meaning: "The carrier's file changes the policy to not taken." },
  cancelled: { label: "Cancelled", meaning: "The carrier's file gives the policy an end date, or a cancelled status word." },
  declined: { label: "Declined", meaning: "The carrier's file changes the policy to declined." },
  withdrawn: { label: "Withdrawn", meaning: "The carrier's file changes the policy to withdrawn." },
  advance_received: { label: "Advance received", meaning: "A commission statement line pays an advance on the policy." },
  commission_credited: { label: "Commission credited", meaning: "A commission statement line credits earned commission on the policy." },
  chargeback_received: { label: "Chargeback received", meaning: "A commission statement line charges commission back on the policy." },
};

export const RULE_MODES = ["draft", "forecast", "live"] as const;
export type RuleMode = (typeof RULE_MODES)[number];
export const MODE_LABELS: Record<RuleMode, string> = { draft: "Draft", forecast: "Forecast", live: "Live" };

/** The fill-ins a note may use, in the order the Rule tab lists them. */
export const FILL_INS = ["paid_to_date", "days_past_due", "days_left", "months_paid", "premium", "amount", "carrier", "policy_number"] as const;
export type FillIn = (typeof FILL_INS)[number];
export type FillValues = Partial<Record<FillIn, string | number | null>>;

/** Defaults for an agency without a settings row (20261102100000's column defaults say the same). */
export const DEFAULT_CAP_PER_RUN = 25;
export const DEFAULT_HAND_MOVE_DAYS = 7;
/** How far back a change (a status word, a paid-to date, a statement line) is still news to a rule. */
export const EVENT_LOOKBACK_DAYS = 30;

export const PIPELINE_RULES_PENDING_MESSAGE = "Pipeline rules need a database update (20261102100000).";

/** The note a rule adds, with its fill-ins filled. A fill-in with no value says so; an unknown one is left as written. */
export function fillNote(template: string, values: FillValues): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) => {
    if (!(FILL_INS as readonly string[]).includes(key)) return whole;
    const value = values[key as FillIn];
    return value === null || value === undefined || value === "" ? "not known" : String(value);
  });
}

/** Fill-ins a template names that this event never has (e.g. {amount} on a status change), for the Rule tab. */
export function fillInsWithoutValue(template: string, event: RuleEvent): FillIn[] {
  const named = [...template.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((key): key is FillIn => (FILL_INS as readonly string[]).includes(key));
  const has = EVENT_FILL_INS[event];
  return [...new Set(named.filter((key) => !has.includes(key)))];
}

const POLICY: FillIn[] = ["carrier", "policy_number", "premium", "paid_to_date", "months_paid"];
const DUE: FillIn[] = [...POLICY, "days_past_due", "days_left"];
const LEDGER: FillIn[] = [...POLICY, "amount"];
/** Which fill-ins each event can fill. */
export const EVENT_FILL_INS: Record<RuleEvent, FillIn[]> = {
  issued: POLICY, waiting_first_payment: DUE, first_payment_missed: DUE, later_payment_missed: DUE, paid_again: POLICY,
  lapsed: POLICY, not_taken: POLICY, cancelled: POLICY, declined: POLICY, withdrawn: POLICY,
  advance_received: LEDGER, commission_credited: LEDGER, chargeback_received: LEDGER,
};

/** A note template's problems, said plainly; empty when it can be saved. */
export function noteProblems(noteOn: boolean, template: string | null): string[] {
  if (!noteOn) return [];
  const text = (template ?? "").trim();
  if (!text) return ["Write the note, or switch the note off."];
  if (text.length > 2000) return ["Keep the note under 2,000 characters."];
  const unknown = [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((key) => !(FILL_INS as readonly string[]).includes(key));
  return unknown.length ? [`These are not fill-ins: ${[...new Set(unknown)].map((k) => `{${k}}`).join(", ")}.`] : [];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "8 Oct 2026" from an ISO day. */
export function noteDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** "$58.20" from cents. */
export function noteMoney(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  const abs = Math.abs(cents) / 100;
  return `${cents < 0 ? "−" : ""}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
