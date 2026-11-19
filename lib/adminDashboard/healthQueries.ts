import "server-only";

import { readPlatformState } from "@/lib/adminAlerts/service";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { describeBillingHeartbeat } from "@/lib/billing/heartbeat";
import { getPeriodBillingHeartbeat } from "@/lib/billing/monitor";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readableTimes } from "./dailyChecks";
import { dailyInputFor } from "./dailyInput";
import type { AppCronRun, DbCronJob, HealthInput } from "./healthJobs";

/**
 * The reads behind Platform health (admin round 1 §5); lib/adminDashboard/healthJobs.ts decides what they
 * mean. Read-only. Every read settles on its own: one that fails shows its row as "Couldn't check" and leaves
 * the others standing. The metrics snapshot and the platform state are the daily checks' own reads (the
 * request's shared input and the staff alerts' minute cache), so this tab and Needs you never disagree.
 */

// app_cron_status, admin_cron_job_status, webhook_events and unclaimed_sla_job_runs are not in the generated
// types; the access stays untyped here, as in lib/adminAlerts/service.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

async function settle<T>(promise: PromiseLike<T>, label: string): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[admin-health] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

type DbError = { code?: string; message?: string } | null | undefined;
/** A function the code expects but the database does not have yet (the migration is not applied). */
function isMissingFunction(error: DbError) {
  return Boolean(error) && (["42883", "PGRST202"].includes(error?.code ?? "") || /could not find the function/i.test(error?.message ?? ""));
}
function check<T>(result: { data: T; error: DbError }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function billing() {
  // The window the staff alerts and the scheduled check use (lib/adminAlerts/service.ts billingRun).
  const maxAgeSeconds = Math.max(3_600, Math.min(Number(process.env.PERIOD_BILLING_HEARTBEAT_SECONDS ?? 129_600), 604_800));
  const heartbeat = await getPeriodBillingHeartbeat(maxAgeSeconds);
  return { healthy: heartbeat.healthy, lastRunAt: heartbeat.lastRunAt, description: readableTimes(describeBillingHeartbeat(heartbeat)) };
}

async function payments(now: number) {
  const [state, processed] = await Promise.all([
    readPlatformState(now),
    db().from("webhook_events").select("processed_at").not("processed_at", "is", null).order("processed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const last = check(processed, "last processed payment event") as { processed_at: string } | null;
  if (!state.stuckWebhooks) throw new Error("waiting payment events could not be read");
  return { stuck: state.stuckWebhooks.count, oldestReceivedAt: state.stuckWebhooks.oldestReceivedAt, lastProcessedAt: last?.processed_at ?? null };
}

async function sources(now: number) {
  const [state, enabled] = await Promise.all([
    readPlatformState(now),
    db().from("compliance_vendors").select("name, last_success_at").eq("is_enabled", true),
  ]);
  const rows = check(enabled, "compliance sources") as { name: string; last_success_at: string | null }[];
  if (!state.failingSources) throw new Error("failing compliance sources could not be read");
  const last = rows.map((row) => row.last_success_at).filter((at): at is string => Boolean(at)).sort().at(-1) ?? null;
  return { enabled: rows.length, failing: state.failingSources.map((row) => row.name), lastSuccessAt: last };
}

async function email(now: number) {
  const since = new Date(now - 86_400_000).toISOString();
  const [last, sent, failed] = await Promise.all([
    db().from("email_log").select("ts").eq("status", "sent").order("ts", { ascending: false }).limit(1).maybeSingle(),
    db().from("email_log").select("id", { count: "exact", head: true }).eq("status", "sent").gte("ts", since),
    db().from("email_log").select("id", { count: "exact", head: true }).eq("status", "failed").gte("ts", since),
  ]);
  const lastRow = check(last, "last email sent") as { ts: string } | null;
  check(sent, "emails sent");
  check(failed, "emails failed");
  return { lastSentAt: lastRow?.ts ?? null, sent24h: sent.count ?? 0, failed24h: failed.count ?? 0 };
}

async function ladder() {
  // The database job's own heartbeat (20260925709910), as lib/queueSla/monitor.ts reads it.
  const result = await db().from("unclaimed_sla_job_runs").select("ok, error, started_at").eq("source", "database").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const row = check(result, "transfer ladder runs") as { ok: boolean; error: string | null; started_at: string } | null;
  return { lastRunAt: row?.started_at ?? null, ok: row?.ok ?? null, error: row?.error ?? null };
}

async function appCron(): Promise<AppCronRun[]> {
  const result = await db().rpc("app_cron_status");
  const rows = check(result, "scheduled app jobs") as Array<{ path: string; last_dispatched_at: string | null; skipped_reason: string | null; http_status: number | null; timed_out: boolean | null }> | null;
  return (rows ?? []).map((row) => ({ path: row.path, lastDispatchedAt: row.last_dispatched_at, skippedReason: row.skipped_reason, httpStatus: row.http_status, timedOut: row.timed_out }));
}

async function dbCron(): Promise<DbCronJob[] | "missing"> {
  const result = await db().rpc("admin_cron_job_status");
  if (isMissingFunction(result.error)) return "missing";
  const rows = check(result, "database jobs") as Array<{ jobname: string; schedule: string; active: boolean; last_start_at: string | null; last_status: string | null; last_message: string | null; last_succeeded_at: string | null }> | null;
  return (rows ?? []).map((row) => ({ jobname: row.jobname, schedule: row.schedule, active: row.active, lastStartAt: row.last_start_at, lastStatus: row.last_status, lastMessage: row.last_message, lastSucceededAt: row.last_succeeded_at }));
}

export async function fetchHealthInput(admin: { id: string; role: AdminRole }): Promise<{ health: HealthInput; maintenance: string | null; featuresOff: number | null }> {
  const now = Date.now();
  const [daily, billingRun, paymentEvents, complianceSources, emailLog, ladderRuns, appJobs, dbJobs] = await Promise.all([
    dailyInputFor(admin.id, admin.role),
    settle(billing(), "billing run"),
    settle(payments(now), "payment events"),
    settle(sources(now), "compliance sources"),
    settle(email(now), "email log"),
    settle(ladder(), "transfer ladder"),
    settle(appCron(), "app jobs"),
    settle(dbCron(), "database jobs"),
  ]);
  return {
    health: { now, snapshot: daily.snapshot, billing: billingRun, payments: paymentEvents, sources: complianceSources, email: emailLog, ladder: ladderRuns, appCron: appJobs, dbCron: dbJobs },
    maintenance: daily.maintenance?.level ?? null,
    featuresOff: daily.featuresOff,
  };
}
