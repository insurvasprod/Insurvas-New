import "server-only";

import { sendEmail } from "@/lib/email/transport";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/appointments/schemaGap";
import { databaseHeartbeatRow, heartbeatState, type SlaHeartbeat } from "./heartbeat";

const JOB_TARGET = "unclaimed-sla";
const SUCCESS_ACTION = "system.unclaimed_sla_run_succeeded";
const FAILURE_ACTION = "system.unclaimed_sla_run_failed";
/** 20260925709910: one row per run, from the database job and from this app job. */
const RUNS_TABLE = "unclaimed_sla_job_runs";

type RunReport = {
  scanned: number;
  claimed: number;
  processed: number;
  failures: Array<{ eventId: string; rung: string; error: string }>;
};

// The live generated types can lag newly promoted audit action names. The table shape itself is
// stable and this narrow boundary keeps that lag out of callers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export async function recordUnclaimedSlaRun(input: { status: "succeeded" | "failed"; report?: RunReport | null; error?: string | null }) {
  const metadata = input.report
    ? { scanned: input.report.scanned, claimed: input.report.claimed, processed: input.report.processed, failures: input.report.failures }
    : { error: input.error?.slice(0, 1000) ?? "Unknown scheduler failure" };
  const result = await db().from("audit_log").insert({
    actor_type: "system",
    actor_id: null,
    action: input.status === "succeeded" ? SUCCESS_ACTION : FAILURE_ACTION,
    target_type: "scheduled_job",
    target_id: JOB_TARGET,
    metadata,
  });
  if (result.error) throw new Error(`Could not record unclaimed SLA heartbeat: ${result.error.message}`);
  // The same run, in the table the database job writes its heartbeat to (20260925709910), so the
  // alert centre and the heartbeat read one history. Before that table exists this is skipped.
  const now = new Date().toISOString();
  const run = await db().from(RUNS_TABLE).insert({
    source: "app",
    started_at: now,
    finished_at: now,
    ok: input.status === "succeeded",
    report: metadata,
    error: input.status === "failed" ? (input.error ?? input.report?.failures[0]?.error ?? "failed").slice(0, 2000) : null,
  });
  if (run.error && !isSchemaGap(run.error)) console.error("Unclaimed SLA run row could not be recorded", run.error.message);
}

export async function getUnclaimedSlaHeartbeat(maxAgeSeconds: number): Promise<SlaHeartbeat> {
  const result = await db()
    .from("audit_log")
    .select("action, metadata, ts")
    .eq("actor_type", "system")
    .eq("target_type", "scheduled_job")
    .eq("target_id", JOB_TARGET)
    .in("action", [SUCCESS_ACTION, FAILURE_ACTION])
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`Could not read unclaimed SLA heartbeat: ${result.error.message}`);
  const appRow = result.data ? { action: result.data.action, metadata: result.data.metadata, created_at: result.data.ts } : null;
  // Since 20260925709910 pg_cron delivers every side effect but the email, every minute, and writes
  // its own heartbeat (source 'database'). Once that table exists it is the only heartbeat: an app
  // run is manual (nothing hosts it), and letting a fresh manual run win would hide a stopped
  // schedule. Before the table exists, the app's own audit heartbeat is all there is.
  const database = await db().from(RUNS_TABLE).select("ok, report, error, started_at, finished_at").eq("source", "database").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (database.error && !isSchemaGap(database.error)) throw new Error(`Could not read the database SLA heartbeat: ${database.error.message}`);
  if (database.error) return heartbeatState(appRow, Date.now(), maxAgeSeconds);
  const dbRun = database.data as { ok: boolean; report: unknown; error: string | null; started_at: string; finished_at: string | null } | null;
  return heartbeatState(databaseHeartbeatRow(dbRun), Date.now(), maxAgeSeconds);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export async function alertUnclaimedSlaOperator(input: { reason: string; detail: string; dedupeKey: string }) {
  const recipient = process.env.UNCLAIMED_SLA_ALERT_EMAIL?.trim()
    || process.env.PLATFORM_ALERT_EMAIL?.trim()
    || process.env.SMTP_FROM_EMAIL?.trim();
  if (!recipient) return { delivered: false as const, reason: "alert_recipient_not_configured" };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const subject = `[Insurvas] Unclaimed lead SLA scheduler ${input.reason}`;
  const text = `${subject}\n\n${input.detail}\n\nHeartbeat: ${appUrl}/api/internal/unclaimed-sla`;
  const html = `<h1>${escapeHtml(subject)}</h1><p>${escapeHtml(input.detail)}</p><p>Heartbeat: <code>${escapeHtml(`${appUrl}/api/internal/unclaimed-sla`)}</code></p>`;
  return sendEmail({
    to: recipient,
    subject,
    text,
    html,
    templateKey: "platform.unclaimed_sla_failure",
    dedupeKey: `platform.unclaimed-sla:${input.dedupeKey}`,
  });
}
