// The admin Trials page's arithmetic (board p-adm-trials), kept pure so it can be tested without a
// database. lib/trials/board.ts reads the rows; this file decides what they mean.
//
// Plain module on purpose: the page (server) and the table (client) both import from here.

export const DAY_MS = 86_400_000;

/** "Last 6 months" on the separation callout. 183 days, so a 31-day month cannot drop a trial. */
export const COHORT_DAYS = 183;

/** The "Ending in 3 days" tile: a trial with three or fewer calendar days left. */
export const ENDING_SOON_DAYS = 3;

export type SignalKey = "leads" | "team" | "carrier";

export const SIGNAL_KEYS: readonly SignalKey[] = ["leads", "team", "carrier"];

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  leads: "Leads",
  team: "Team",
  carrier: "Carrier",
};

/** What each pill measures, in words, for the hover text and the expanded row. */
export const SIGNAL_MEANINGS: Record<SignalKey, string> = {
  leads: "Imported a lead file",
  team: "Invited a second user",
  carrier: "Added a carrier appointment",
};

/**
 * When a tenant first reached each activation signal, or null if it never has.
 *
 * - leads   — the first lead-file import that completed (agent_lead_import_batches, completed).
 * - team    — the moment the workspace had two members: the second-earliest tenant_users invite.
 * - carrier — the first carrier appointment added (tenant_carriers).
 *
 * Stored as moments rather than booleans so a trial that ENDED can be judged on what it had done
 * by the time it ended, not on what the tenant did afterwards.
 */
export type SignalMoments = Record<SignalKey, string | null>;

export const NO_SIGNALS: SignalMoments = { leads: null, team: null, carrier: null };

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** The earliest of a set of timestamps, as ISO, or null. */
export function earliest(values: readonly (string | null | undefined)[]): string | null {
  return nth(values, 0);
}

/** The second-earliest — the moment a workspace had two members. */
export function secondEarliest(values: readonly (string | null | undefined)[]): string | null {
  return nth(values, 1);
}

function nth(values: readonly (string | null | undefined)[], index: number): string | null {
  const sorted = values
    .map((value) => ({ value, ms: time(value) }))
    .filter((entry): entry is { value: string; ms: number } => entry.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  return sorted[index]?.value ?? null;
}

/** Whether each signal had been reached by `at`. */
export function signalsAt(moments: SignalMoments, at: Date): Record<SignalKey, boolean> {
  const limit = at.getTime();
  const reached = (iso: string | null) => {
    const ms = time(iso);
    return ms !== null && ms <= limit;
  };
  return { leads: reached(moments.leads), team: reached(moments.team), carrier: reached(moments.carrier) };
}

/**
 * Whole calendar days (UTC) from now to the trial's end, never below zero.
 *
 * Counted in dates, not `ceil(ms / day)`: the end date prints beside the number, and "2 days" next
 * to a date two days away must agree (the same reasoning as lib/trials/banner.ts). UTC so the
 * server and every reader count the same dates.
 */
export function calendarDaysLeft(endIso: string, now: Date): number {
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return 0;
  const midnight = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(0, Math.round((midnight(end) - midnight(now)) / DAY_MS));
}

/** Converted = the trial became a paying subscription (the reading lib/trials/queries.ts uses). */
export function isConvertedStatus(status: string): boolean {
  return status === "active" || status === "past_due" || status === "cancelling";
}

export type EndedTrialInput = {
  status: string;
  started_at: string;
  trial_ends_at: string;
  cancelled_at: string | null;
  /** The tenant's first successful payment on or after the subscription started, if any. */
  first_paid_at: string | null;
  /**
   * Recorded by the subscriptions_record_trial_outcome trigger (20260925502000) the moment the
   * status left 'trialing'. Absent before that migration and null for older trials, which are
   * still inferred below.
   */
  trial_outcome?: string | null;
  trial_outcome_at?: string | null;
};

/** Whether the trial converted: the recorded outcome when there is one, else the current status. */
export function trialConverted(trial: Pick<EndedTrialInput, "status" | "trial_outcome">): boolean {
  if (trial.trial_outcome === "converted") return true;
  if (trial.trial_outcome === "lapsed") return false;
  return isConvertedStatus(trial.status);
}

/**
 * When a trial that is no longer trialing ended, or null when that cannot be told.
 *
 * Nothing records the moment a trial converted or lapsed, so this reads the nearest evidence:
 * a conversion is dated by the first successful payment (the webhook converts on payment), falling
 * back to the trial end when it has passed; a lapse is dated by the cancellation, falling back to
 * the trial end or now, whichever came first — a subscription cancelled with no recorded date
 * ended no later than now.
 */
export function trialEndedAt(trial: EndedTrialInput, now: Date): Date | null {
  if (trial.status === "trialing") return null;
  const recorded = time(trial.trial_outcome_at ?? null);
  if (recorded !== null) return new Date(recorded);
  const nowMs = now.getTime();
  const trialEnd = time(trial.trial_ends_at);

  if (trialConverted(trial)) {
    const paid = time(trial.first_paid_at);
    if (paid !== null) return new Date(paid);
    return trialEnd !== null && trialEnd <= nowMs ? new Date(trialEnd) : null;
  }

  const cancelled = time(trial.cancelled_at);
  if (cancelled !== null) return new Date(cancelled);
  if (trialEnd === null) return null;
  return new Date(Math.min(trialEnd, nowMs));
}

/** First instant of the current UTC calendar month. */
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type Ratio = { n: number; converted: number };

/** "71%", or null when there is nothing to divide. */
export function rate(ratio: Ratio): number | null {
  return ratio.n === 0 ? null : ratio.converted / ratio.n;
}

export function percentLabel(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export type CohortTrial = EndedTrialInput & {
  tenant_id: string;
  signals: SignalMoments;
  owner_signed_in: boolean;
};

export type Separation = {
  /** Ended trials that started within the window. */
  cohort: number;
  both: Ratio;
  neither: Ratio;
  ownerSignedIn: Ratio;
  ownerNeverSignedIn: Ratio;
  averageDaysToConvert: number | null;
};

/**
 * The callout's comparison: of the trials that ended and started in the last six months, how the
 * ones that imported leads AND invited a second user converted, against the ones that did neither.
 * Signals are judged at the moment each trial ended.
 */
export function separation(trials: readonly CohortTrial[], now: Date): Separation {
  const windowStart = now.getTime() - COHORT_DAYS * DAY_MS;
  const both: Ratio = { n: 0, converted: 0 };
  const neither: Ratio = { n: 0, converted: 0 };
  const signedIn: Ratio = { n: 0, converted: 0 };
  const neverSignedIn: Ratio = { n: 0, converted: 0 };
  const lengths: number[] = [];
  let cohort = 0;

  for (const trial of trials) {
    if (trial.status === "trialing") continue;
    const started = time(trial.started_at);
    if (started === null || started < windowStart) continue;
    cohort += 1;

    const converted = trialConverted(trial);
    const trialEnd = time(trial.trial_ends_at);
    const judgedAt = trialEndedAt(trial, now) ?? new Date(Math.min(trialEnd ?? now.getTime(), now.getTime()));
    const reached = signalsAt(trial.signals, judgedAt);

    if (reached.leads && reached.team) bump(both, converted);
    if (!reached.leads && !reached.team) bump(neither, converted);
    bump(trial.owner_signed_in ? signedIn : neverSignedIn, converted);

    if (converted && trialEnd !== null) {
      const days = (trialEnd - started) / DAY_MS;
      if (Number.isFinite(days) && days >= 0) lengths.push(days);
    }
  }

  return {
    cohort,
    both,
    neither,
    ownerSignedIn: signedIn,
    ownerNeverSignedIn: neverSignedIn,
    averageDaysToConvert:
      lengths.length === 0 ? null : Math.round((lengths.reduce((a, b) => a + b, 0) / lengths.length) * 10) / 10,
  };
}

function bump(ratio: Ratio, converted: boolean) {
  ratio.n += 1;
  if (converted) ratio.converted += 1;
}

export type MonthOutcome = { converted: number; lapsed: number; undated: number };

/** Trials that converted or lapsed during the current UTC month (see trialEndedAt for the dating). */
export function monthOutcome(trials: readonly EndedTrialInput[], now: Date): MonthOutcome {
  const start = utcMonthStart(now).getTime();
  const out: MonthOutcome = { converted: 0, lapsed: 0, undated: 0 };
  for (const trial of trials) {
    if (trial.status === "trialing") continue;
    const ended = trialEndedAt(trial, now);
    if (!ended) {
      out.undated += 1;
      continue;
    }
    const ms = ended.getTime();
    if (ms < start || ms > now.getTime()) continue;
    if (trialConverted(trial)) out.converted += 1;
    else out.lapsed += 1;
  }
  return out;
}

// Hand-built rather than Intl: en-GB prints "Sept" in current ICU builds and "Sep" in older ones,
// and the board (and every other admin date) reads "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The board's table date: "1 Sep" this year, "1 Sep 2025" otherwise. UTC. */
export function trialShortDate(iso: string | null, now: Date): string {
  const ms = time(iso);
  if (ms === null) return "—";
  const date = new Date(ms);
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return date.getUTCFullYear() === now.getUTCFullYear() ? day : `${day} ${date.getUTCFullYear()}`;
}

/** "22 Sep 2026 08:40:55 UTC" — the admin console's timestamp, zone shown. */
export function trialFullUtc(iso: string | null): string {
  const ms = time(iso);
  if (ms === null) return "—";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/**
 * "ends today", "ends in 1 day", "ends in 4 days" — or, for a trial whose end has passed while it is
 * still marked as trialing, says so rather than claiming it ends today.
 */
export function endsInPhrase(daysLeft: number, overdue = false): string {
  if (overdue) return "is past its end date";
  if (daysLeft <= 0) return "ends today";
  return daysLeft === 1 ? "ends in 1 day" : `ends in ${daysLeft} days`;
}
