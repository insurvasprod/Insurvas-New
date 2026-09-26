/**
 * The alert centre's reading of the unclaimed-SLA job (LA-1.23-7, "the job reports what it did,
 * failures alert"). Pure, no `server-only`, so the rules are tested.
 */

export type SlaEventRow = {
  rung: string;
  handled_by: string | null;
  skipped_reason: string | null;
  outcome: Record<string, unknown> | null;
  processed_at: string | null;
  last_error: string | null;
  email_due_at: string | null;
  email_done_at: string | null;
  email_outcome: string | null;
};

export type SlaDaySummary = {
  /** Escalations that alerted the owners. */
  escalationsAlerted: number;
  partnerNotices: number;
  nobodyClaimedAlerts: number;
  nurtured: number;
  warnings: number;
  /** Recorded and not sent: older than a day, or claimed or expired before the job reached it. */
  skipped: number;
  /** Given up after five failed tries. */
  gaveUp: number;
  /** Failing now, being tried again each minute. */
  retrying: number;
  emailsOwed: number;
  emailsSent: number;
  /** The newest failure message, when one is being retried or was given up. */
  latestError: string | null;
};

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function summariseSlaDay(rows: SlaEventRow[]): SlaDaySummary {
  const summary: SlaDaySummary = { escalationsAlerted: 0, partnerNotices: 0, nobodyClaimedAlerts: 0, nurtured: 0, warnings: 0, skipped: 0, gaveUp: 0, retrying: 0, emailsOwed: 0, emailsSent: 0, latestError: null };
  for (const row of rows) {
    if (row.processed_at === null) {
      if (row.last_error) { summary.retrying += 1; summary.latestError ??= row.last_error; }
      continue;
    }
    if (row.skipped_reason === "gave_up_after_failures") { summary.gaveUp += 1; summary.latestError ??= row.last_error; continue; }
    if (row.skipped_reason) { summary.skipped += 1; continue; }
    const outcome = row.outcome ?? {};
    if (row.rung === "warn") summary.warnings += 1;
    if (row.rung === "escalate" && count(outcome.ownerAlerts) + count(outcome.offered) > 0) summary.escalationsAlerted += 1;
    if (row.rung === "partner") {
      if (typeof outcome.partnerMessageId === "string") summary.partnerNotices += 1;
      if (count(outcome.nobodyClaimedOwnerAlerts) > 0) summary.nobodyClaimedAlerts += 1;
    }
    if (row.rung === "expire") {
      const nurture = outcome.nurture as Record<string, unknown> | undefined;
      if (nurture && nurture.nurtured === true && nurture.duplicate !== true) summary.nurtured += 1;
    }
    if (row.email_due_at) {
      if (row.email_done_at === null) summary.emailsOwed += 1;
      else if (row.email_outcome === "sent") summary.emailsSent += 1;
    }
  }
  return summary;
}

export type SlaJobState = "ok" | "failing" | "stale" | "never_run" | "pending_migration";

/** The job runs every minute. Five minutes without a run means it has stopped. */
export const SLA_JOB_STALE_SECONDS = 300;

export function slaJobState(input: { lastRunAt: string | null; lastRunOk: boolean | null; retrying: number }, nowMs: number): SlaJobState {
  if (!input.lastRunAt) return "never_run";
  const age = (nowMs - Date.parse(input.lastRunAt)) / 1000;
  if (!Number.isFinite(age) || age > SLA_JOB_STALE_SECONDS) return "stale";
  if (input.lastRunOk === false || input.retrying > 0) return "failing";
  return "ok";
}
