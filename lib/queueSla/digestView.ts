/**
 * The alert centre's reading of the unclaimed-SLA job (LA-1.23-7, "the job reports what it did,
 * failures alert"). Pure, no `server-only` and no imports, so the rules are tested.
 */

/** A side effect this old is recorded as skipped, never sent (user decision, 20260925709900). */
export const STALE_AFTER_MS = 86_400_000;

/** True when `iso` is more than a day before `nowMs`. An unreadable time is not treated as old. */
export function isOlderThanADay(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at < nowMs - STALE_AFTER_MS;
}

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

/**
 * Whether the run failed as a whole — the ladder, the digest, or the run itself — as opposed to one
 * tenant's event failing. Only a whole-run failure is every workspace's news: an event failing in
 * another workspace is that workspace's, and its message is never shown here.
 */
export function runFailedAsWhole(report: unknown, error: string | null): boolean {
  const r = report && typeof report === "object" && !Array.isArray(report) ? (report as Record<string, unknown>) : {};
  const nested = (key: string) => {
    const value = r[key];
    return value && typeof value === "object" ? (value as Record<string, unknown>).error : null;
  };
  if (typeof r.error === "string" && r.error) return true;
  if (typeof nested("ladder") === "string" && nested("ladder")) return true;
  if (typeof nested("digest") === "string" && nested("digest")) return true;
  // A row with an error and no report is a run that died before it could say what it did.
  return Boolean(error) && Object.keys(r).length === 0;
}

export function slaJobState(input: { lastRunAt: string | null; lastRunOk: boolean | null; retrying: number }, nowMs: number): SlaJobState {
  if (!input.lastRunAt) return "never_run";
  const age = (nowMs - Date.parse(input.lastRunAt)) / 1000;
  if (!Number.isFinite(age) || age > SLA_JOB_STALE_SECONDS) return "stale";
  if (input.lastRunOk === false || input.retrying > 0) return "failing";
  return "ok";
}

/** What the first tile and the one-line alert say for each state. */
export function slaJobWords(state: SlaJobState): { label: string; alert: string | null } {
  switch (state) {
    case "ok":
      return { label: "Running", alert: null };
    case "failing":
      return { label: "Failing", alert: "The unclaimed-SLA job is failing. Failed items are tried again every minute." };
    case "stale":
      return { label: "Stopped", alert: "The unclaimed-SLA job has stopped. Escalation alerts, partner notices and nurture moves are not being sent." };
    case "never_run":
      return { label: "Not run yet", alert: "The unclaimed-SLA job has not run yet. Escalation alerts, partner notices and nurture moves are sent once it does." };
    default:
      return { label: "Not set up", alert: null };
  }
}

/** The one line shown in place of the SLA figures and the digest until 20260925709910 is applied. */
export const SLA_PENDING_LINE = "The unclaimed-SLA job's figures need a database update that has not been applied yet.";

/**
 * Settings › Queue & SLA: one line when the rungs fire but what they cause is not delivered. Nothing
 * when the job is running — the screen is about the thresholds, not the job.
 */
export function slaJobNotice(state: SlaJobState): { tone: "info" | "error"; text: string } | null {
  if (state === "ok") return null;
  if (state === "pending_migration") return { tone: "info", text: "Escalation alerts, partner notices and nurture moves need a database update that has not been applied yet." };
  return { tone: "error", text: slaJobWords(state).alert ?? "The unclaimed-SLA job is not running." };
}
