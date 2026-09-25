import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/appointments/schemaGap";
import { zonedParts } from "@/lib/format/dates";
import { summariseSlaDay, slaJobState, type SlaDaySummary, type SlaJobState } from "./digestView";

/**
 * What the alert centre shows about the unclaimed-SLA job (LA-1.23-6 and -7), read from what the
 * database job writes every minute (20260925709910):
 *
 *   tenant_sla_daily_digests   escalated and expired per partner, one row per day in the agency's
 *                              timezone. Today's row fills during the day, and closes at midnight.
 *   unclaimed_sla_job_runs     one heartbeat per run, with its report. Platform-wide, so only the
 *                              time and whether it succeeded are shown, never another tenant's counts.
 *   tenant_lead_sla_events     this workspace's rows the job handled in the last 24 hours.
 *
 * Before that migration the tables are not there, and each read says so rather than failing the page.
 */

// The generated types lag the SLA tables; keep the untyped boundary to this file, like service.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export type SlaDigestPartner = { partnerId: string | null; partnerName: string; escalated: number; expired: number };
export type SlaDigestDay = { date: string; timezone: string; escalated: number; expired: number; closed: boolean; today: boolean; partners: SlaDigestPartner[] };

function dateIn(zone: string, now: Date) {
  const p = zonedParts(now, zone);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : null;
}

export async function getSlaDailyDigests(tenantId: string, days = 7, now = new Date()): Promise<{ ready: boolean; days: SlaDigestDay[] }> {
  const result = await db().from("tenant_sla_daily_digests").select("digest_date, timezone, escalated, expired, by_partner, closed").eq("tenant_id", tenantId).order("digest_date", { ascending: false }).limit(days);
  if (result.error) {
    if (isSchemaGap(result.error)) return { ready: false, days: [] };
    throw new Error(`Could not read the SLA digest: ${result.error.message}`);
  }
  const rows = (result.data ?? []) as Array<{ digest_date: string; timezone: string; escalated: number; expired: number; by_partner: unknown; closed: boolean }>;
  return {
    ready: true,
    days: rows.map((row) => ({
      date: row.digest_date,
      timezone: row.timezone,
      escalated: row.escalated,
      expired: row.expired,
      closed: row.closed,
      today: !row.closed && row.digest_date === dateIn(row.timezone, now),
      partners: (Array.isArray(row.by_partner) ? row.by_partner : []).map((item: Record<string, unknown>) => ({
        partnerId: typeof item.partnerId === "string" ? item.partnerId : null,
        partnerName: typeof item.partnerName === "string" ? item.partnerName : "No partner",
        escalated: Number(item.escalated ?? 0),
        expired: Number(item.expired ?? 0),
      })),
    })),
  };
}

export type SlaJobStatus = {
  ready: boolean;
  state: SlaJobState;
  lastRunAt: string | null;
  lastError: string | null;
  lastDay: SlaDaySummary;
};

export async function getSlaJobStatus(tenantId: string, now = new Date()): Promise<SlaJobStatus> {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const [run, events] = await Promise.all([
    db().from("unclaimed_sla_job_runs").select("ok, error, started_at, finished_at").eq("source", "database").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    // Handled in the last day, and anything still being retried.
    db().from("tenant_lead_sla_events").select("rung, handled_by, skipped_reason, outcome, processed_at, last_error, email_due_at, email_done_at, email_outcome").eq("tenant_id", tenantId).or(`processed_at.gte."${since}",and(processed_at.is.null,last_error.not.is.null)`).limit(2000),
  ]);
  if (run.error || events.error) {
    if (isSchemaGap(run.error) || isSchemaGap(events.error)) return { ready: false, state: "pending_migration", lastRunAt: null, lastError: null, lastDay: summariseSlaDay([]) };
    throw new Error(`Could not read the SLA job status: ${(run.error ?? events.error).message}`);
  }
  const latest = run.data as { ok: boolean; error: string | null; started_at: string; finished_at: string | null } | null;
  const lastRunAt = latest ? latest.finished_at ?? latest.started_at : null;
  const lastDay = summariseSlaDay((events.data ?? []) as Parameters<typeof summariseSlaDay>[0]);
  return {
    ready: true,
    state: slaJobState({ lastRunAt, lastRunOk: latest?.ok ?? null, retrying: lastDay.retrying }, now.getTime()),
    lastRunAt,
    lastError: latest && !latest.ok ? latest.error : null,
    lastDay,
  };
}
