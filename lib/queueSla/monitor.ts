import "server-only";

import { sendEmail } from "@/lib/email/transport";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { heartbeatState, type SlaHeartbeat } from "./heartbeat";

const JOB_TARGET = "unclaimed-sla";
const SUCCESS_ACTION = "system.unclaimed_sla_run_succeeded";
const FAILURE_ACTION = "system.unclaimed_sla_run_failed";

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
  const row = result.data ? { action: result.data.action, metadata: result.data.metadata, created_at: result.data.ts } : null;
  return heartbeatState(row, Date.now(), maxAgeSeconds);
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
