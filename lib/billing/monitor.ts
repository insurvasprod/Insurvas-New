import "server-only";

// Recording that the billing run happened, and telling somebody when it stops (backlog 24).
//
// Modelled on lib/queueSla/monitor.ts, which does the same job for the unclaimed-lead scheduler and
// has been proven in production. Same audit_log shape, same dedupe discipline, same environment
// variables where they mean the same thing — a second, differently-shaped monitoring mechanism for
// the second scheduled job is how a platform ends up with two half-watched jobs.

import { sendEmail } from "@/lib/email/transport";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  billingHeartbeatState,
  describeBillingHeartbeat,
  BILLING_RUN_SUCCEEDED,
  BILLING_RUN_FAILED,
  type BillingHeartbeat,
} from "./heartbeat";

const JOB_TARGET = "period-billing";

/**
 * How long after a period ends before an unbilled subscription counts as a failure.
 *
 * Not zero. The job runs on a schedule, so between a period ending and the next run there is
 * always a window in which a subscription is legitimately unbilled — a grace of zero would alert
 * every single day, and an alert that always fires is one nobody reads. A day is comfortably
 * longer than the daily cron's interval and far shorter than a billing cycle.
 */
const UNBILLED_GRACE_HOURS = 24;

// The live generated types can lag newly promoted audit action names. The table shape itself is
// stable and this narrow boundary keeps that lag out of callers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

type RunReport = {
  considered: number;
  invoicesRaised: number;
  totalCents: number;
  creditAppliedCents: number;
  waivedCents: number;
  failures: Array<{ subscriptionId: string; error: string }>;
};

export async function recordPeriodBillingRun(input: {
  status: "succeeded" | "failed";
  report?: RunReport | null;
  error?: string | null;
}) {
  const metadata = input.report
    ? { ...input.report }
    : { error: input.error?.slice(0, 1000) ?? "Unknown scheduler failure" };

  const result = await db().from("audit_log").insert({
    actor_type: "system",
    actor_id: null,
    action: input.status === "succeeded" ? BILLING_RUN_SUCCEEDED : BILLING_RUN_FAILED,
    target_type: "scheduled_job",
    target_id: JOB_TARGET,
    metadata,
  });

  if (result.error) throw new Error(`Could not record the period billing heartbeat: ${result.error.message}`);
}

/**
 * Subscriptions whose period ended more than the grace window ago and that have no ledger row.
 *
 * This is the check #24 asks for, and it is deliberately asked of `period_billing_runs` rather
 * than of invoices: a period that was examined and had nothing to bill still writes a ledger row,
 * so "no row" means "not examined" rather than "nothing owed". Counting invoices instead would
 * report every customer with no add-ons as unbilled forever.
 */
export async function countUnbilledEndedPeriods(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - UNBILLED_GRACE_HOURS * 3_600_000).toISOString();

  const { data: due, error } = await db()
    .from("subscriptions")
    .select("id, current_period_start")
    .neq("status", "cancelled")
    .not("current_period_end", "is", null)
    .lte("current_period_end", cutoff);

  if (error) throw new Error(`Could not read subscriptions due for billing: ${error.message}`);

  const rows = (due ?? []).filter((row: { current_period_start: string | null }) => row.current_period_start);
  if (rows.length === 0) return 0;

  const { data: billed, error: ledgerError } = await db()
    .from("period_billing_runs")
    .select("subscription_id, period_start")
    .in("subscription_id", rows.map((row: { id: string }) => row.id));

  if (ledgerError) throw new Error(`Could not read the billing ledger: ${ledgerError.message}`);

  // Keyed on both columns. A subscription billed for an earlier period is not billed for this one,
  // and matching on subscription_id alone would call it done forever after its first invoice.
  const seen = new Set(
    (billed ?? []).map((row: { subscription_id: string; period_start: string }) =>
      `${row.subscription_id}:${Date.parse(row.period_start)}`),
  );

  return rows.filter((row: { id: string; current_period_start: string }) =>
    !seen.has(`${row.id}:${Date.parse(row.current_period_start)}`)).length;
}

export async function getPeriodBillingHeartbeat(maxAgeSeconds: number): Promise<BillingHeartbeat> {
  const result = await db()
    .from("audit_log")
    .select("action, metadata, ts")
    .eq("actor_type", "system")
    .eq("target_type", "scheduled_job")
    .eq("target_id", JOB_TARGET)
    .in("action", [BILLING_RUN_SUCCEEDED, BILLING_RUN_FAILED])
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) throw new Error(`Could not read the period billing heartbeat: ${result.error.message}`);

  const row = result.data
    ? { action: result.data.action, metadata: result.data.metadata, created_at: result.data.ts }
    : null;

  return billingHeartbeatState({
    row,
    nowMs: Date.now(),
    maxAgeSeconds,
    unbilledCount: await countUnbilledEndedPeriods(),
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export async function alertBillingOperator(input: { reason: string; detail: string; dedupeKey: string }) {
  const recipient = process.env.PERIOD_BILLING_ALERT_EMAIL?.trim()
    || process.env.PLATFORM_ALERT_EMAIL?.trim()
    || process.env.SMTP_FROM_EMAIL?.trim();

  if (!recipient) return { delivered: false as const, reason: "alert_recipient_not_configured" };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const subject = `[Insurvas] Period billing run ${input.reason}`;
  const text = `${subject}\n\n${input.detail}\n\nHeartbeat: ${appUrl}/api/internal/period-billing`;
  const html = `<h1>${escapeHtml(subject)}</h1><p>${escapeHtml(input.detail)}</p><p>Heartbeat: <code>${escapeHtml(`${appUrl}/api/internal/period-billing`)}</code></p>`;

  return sendEmail({
    to: recipient,
    subject,
    text,
    html,
    templateKey: "platform.period_billing_failure",
    dedupeKey: `platform.period-billing:${input.dedupeKey}`,
  });
}

export { describeBillingHeartbeat };
