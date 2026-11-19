// Admin › Monitoring › Jobs & services (admin round 1, docs/design/admin-r1/monitoring.html screen 6): the dashboard's
// Platform health list (lib/adminDashboard/healthJobs.ts, imported, not forked) given a home, with each job's own
// sheet — what it does, its schedule, its last answer, the reason in plain words, how to fix it, and whether
// "Run now" applies. Plain module: every decision is made from values the reads hand over, so it is testable.

import { APP_JOBS, describeCron, type HealthInput, type HealthRow, type HealthStatus } from "../adminDashboard/healthJobs.ts";

/**
 * The schedule each /api/cron route is called on, as the database schedules it (20261015500000_app_cron_dispatcher.sql;
 * pipeline-rules in 20261102100000_pipeline_rules.sql). The live schedule comes from admin_cron_job_status() once
 * 20261117310000 is applied; this is what the migrations set.
 */
export const APP_SCHEDULES: Record<string, string> = {
  "/api/cron/period-billing": "0 3 * * *",
  "/api/cron/invoices-overdue": "30 3 * * *",
  "/api/cron/metrics-daily": "0 4 * * *",
  "/api/cron/trial-reminders": "0 14 * * *",
  "/api/cron/notifications": "*/5 * * * *",
  "/api/cron/webhooks": "* * * * *",
  "/api/cron/unclaimed-sla": "* * * * *",
  "/api/cron/callback-reminders": "*/5 * * * *",
  "/api/cron/calendar-busy": "*/15 * * * *",
  "/api/cron/licence-lapse": "5 * * * *",
  "/api/cron/complaint-deadlines": "0 13 * * *",
  "/api/cron/compliance-monthly": "0 14 * * *",
  "/api/cron/retention-summary": "0 5 * * *",
  "/api/cron/deletion-perform": "15 * * * *",
  "/api/cron/pipeline-rules": "0 11 * * *",
};

/** Rows folded from an app route (healthJobs.ts `foldInto`) answer for that route. */
const FOLDED: Record<string, string> = { metrics: "/api/cron/metrics-daily", billing: "/api/cron/period-billing" };

/** The /api/cron path behind a Platform health row, when it is an app job. */
export function jobPathOf(rowKey: string): string | null {
  if (FOLDED[rowKey]) return FOLDED[rowKey];
  if (rowKey.startsWith("app:/api/cron/")) return rowKey.slice(4);
  return null;
}

/** "/api/cron/metrics-daily" → "metrics-daily": the job's name in /api/admin/monitoring/jobs/[key]. */
export function jobSlugOf(path: string): string {
  return path.replace(/^\/api\/cron\//, "");
}

/** The app jobs "Run now" may call: the routes Platform health names (APP_JOBS), nothing a caller makes up. */
export const RUNNABLE_SLUGS: readonly string[] = Object.keys(APP_JOBS).map(jobSlugOf);

export function isRunnableSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && RUNNABLE_SLUGS.includes(slug);
}

/** A Platform health row with what its sheet needs. */
export type JobDetail = HealthRow & {
  /** The /api/cron path, for app jobs. */
  path: string | null;
  /** The schedule in words and as cron, when known. */
  schedule: { words: string; cron: string } | null;
  /** The last answer the database got from the app (app_cron_status), for app jobs. */
  lastCall: { at: string | null; httpStatus: number | null; timedOut: boolean | null; skippedReason: string | null } | null;
  /** A database job's own last run (admin_cron_job_status). */
  dbRun: { lastStartAt: string | null; lastStatus: string | null; lastMessage: string | null; active: boolean } | null;
  /** How to fix it, in plain words; null when it is working. */
  fix: string | null;
};

const SECRET_FIX =
  "Make the job password the database sends (the vault secret cron_secret) match the app's CRON_SECRET, or point the vault secret app_base_url at the right app address. Then press Run now to check the job itself works.";

/** How to fix one row, from its status and, for an app job, the database's last call. */
export function jobFix(status: HealthStatus, key: string, call: JobDetail["lastCall"], dbRun: JobDetail["dbRun"]): string | null {
  if (status === "working") return null;
  if (status === "not_watched") return "Apply migration 20261117310000 (admin_cron_job_status) so these runs can be read here.";
  if (call) {
    if (call.skippedReason?.includes("pg_net")) return "Enable the pg_net extension in the database; until then every scheduled call is skipped.";
    if (call.skippedReason?.includes("app_base_url")) return "Create the vault secret app_base_url (the app's production address) in the SQL editor; until then every scheduled call is skipped.";
    if (call.skippedReason?.includes("cron_secret")) return "Create the vault secret cron_secret (the app's CRON_SECRET) in the SQL editor; until then every scheduled call is skipped.";
    if (!call.at) return "The database has never called it. Check the job is scheduled (cron.job, app-cron-*); 20261015500000 schedules them.";
    if (call.httpStatus === 401 || call.httpStatus === 403) return SECRET_FIX;
    if (call.timedOut) return "The job took longer than the database waits (60 seconds). Press Run now to see how long it takes and what it answers; the server log has the detail.";
    if (call.httpStatus !== null && call.httpStatus >= 500) return "The app failed while running it. The answer below and the server log (search for the job's route) say why; fix that, then press Run now.";
    if (call.httpStatus !== null && (call.httpStatus < 200 || call.httpStatus >= 300)) return "The app turned the call down. The answer below says why.";
    if (status === "look") return "The database has stopped calling it on time. Check its pg_cron job is active (cron.job).";
    if (status === "unknown") return "The answer to the last call is no longer kept (about six hours). Wait for the next call, or press Run now.";
  }
  if (dbRun) {
    if (!dbRun.active) return "The database job is switched off. Switch it on in cron.job if it should run.";
    if (dbRun.lastStatus === "failed") return "Read the error below, fix its cause in the database, and it runs again on its schedule.";
    if (!dbRun.lastStartAt) return "No run in the last week. Check the job's schedule in cron.job.";
  }
  if (status === "unknown") return "Its record could not be read just now. Reload the page; if it stays, the server log has the error.";
  if (key === "payments") return "Open Payment provider to see the waiting events and run a stuck one again.";
  if (key === "compliance") return "Open Compliance sources to test the source that is not answering.";
  if (key === "email") return "Open Email to see the failed sends and their errors.";
  if (key === "metrics" || key === "billing") return SECRET_FIX;
  return "Open the page it links to for the detail.";
}

/** Every row with its sheet's facts, in the list's order (failing first). */
export function jobDetails(input: HealthInput, rows: readonly HealthRow[]): JobDetail[] {
  const calls = new Map((input.appCron ?? []).map((run) => [run.path, run]));
  const dbJobs = new Map((Array.isArray(input.dbCron) ? input.dbCron : []).map((job) => [job.jobname, job]));
  return rows.map((row) => {
    const path = jobPathOf(row.key);
    const run = path ? calls.get(path) : undefined;
    const dbName = row.key.startsWith("db:") ? row.key.slice(3) : row.key === "ladder" ? "unclaimed-sla-side-effects" : null;
    const dbJob = dbName ? dbJobs.get(dbName) : undefined;
    // The database's own record of the app job's schedule wins over the migration's when it can be read.
    const cron = (path && dbJobs.get(`app-cron-${jobSlugOf(path)}`)?.schedule) || (path ? APP_SCHEDULES[path] : null) || dbJob?.schedule || null;
    const lastCall = path ? (run ? { at: run.lastDispatchedAt, httpStatus: run.httpStatus, timedOut: run.timedOut, skippedReason: run.skippedReason } : { at: null, httpStatus: null, timedOut: null, skippedReason: null }) : null;
    const dbRun = dbJob ? { lastStartAt: dbJob.lastStartAt, lastStatus: dbJob.lastStatus, lastMessage: dbJob.lastMessage, active: dbJob.active } : null;
    return {
      ...row,
      path,
      schedule: cron ? { words: describeCron(cron), cron } : null,
      lastCall: input.appCron === null ? null : lastCall,
      dbRun,
      fix: jobFix(row.status, row.key, input.appCron === null ? null : lastCall, dbRun),
    };
  });
}

/** The status line's cause: the one thing that explains most failures, when there is one. */
export function jobsCause(input: HealthInput): string | null {
  const refused = (input.appCron ?? []).filter((run) => run.httpStatus === 401 || run.httpStatus === 403).length;
  if (refused > 0) return `the app refuses the database's scheduled calls (401): the job password or the app address in the database doesn't match`;
  const skipped = (input.appCron ?? []).find((run) => run.skippedReason)?.skippedReason;
  if (skipped) return `the database skips its scheduled calls: ${skipped}`;
  return null;
}

/** "200 OK", "401 Refused", "Timed out", "Skipped", "Not kept": an answer as a short word for a chip. */
export function answerLabel(call: { httpStatus: number | null; timedOut: boolean | null; skippedReason: string | null }): { text: string; tone: "good" | "danger" | "neutral" } {
  if (call.skippedReason) return { text: "Skipped", tone: "danger" };
  if (call.timedOut) return { text: "Timed out", tone: "danger" };
  if (call.httpStatus === null) return { text: "Not kept", tone: "neutral" };
  if (call.httpStatus >= 200 && call.httpStatus < 300) return { text: String(call.httpStatus), tone: "good" };
  return { text: String(call.httpStatus), tone: "danger" };
}
