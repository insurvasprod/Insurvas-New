import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * "Last seven days" on the Queue & SLA screen, read rather than typed.
 *
 *   rungs   `tenant_lead_sla_events`, one row per queue item per rung (unique on work item + rung),
 *           counted by `occurred_at` in the window. A reopened lead cannot fire the same rung twice.
 *   claims  `lead_queue.claimed_at - queued_at` for every item claimed in the window. Reopening an
 *           expired lead resets `queued_at`, so its clock restarts from the reopen.
 *
 * Inbound transfers only — the items with a partner — because that is all the ladder runs over
 * (20260924150000). A dialer lead is served, not claimed, so its "wait" would be meaningless here.
 */

export type SlaLastSevenDays = {
  since: string;
  /** Items claimed in the window whose wait was under the warn threshold. */
  claimedInsideWarn: number;
  claimed: number;
  warned: number;
  escalated: number;
  partnerTold: number;
  expired: number;
  /** Seconds, or null when nothing was claimed. */
  medianClaimSeconds: number | null;
  /** True when more claims existed than were read; the median is then over the most recent ones. */
  sampleCapped: boolean;
};

const PAGE = 1000;
const MAX_PAGES = 20;

// The generated types lag the SLA tables; keep the untyped boundary to this file, like service.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export async function getSlaLastSevenDays(tenantId: string, warnAfterSeconds: number, now = new Date()): Promise<SlaLastSevenDays> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const client = db();

  const countRung = (rung: string) =>
    client
      .from("tenant_lead_sla_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("rung", rung)
      .gte("occurred_at", since);

  const [warn, escalate, partner, expire] = await Promise.all(["warn", "escalate", "partner", "expire"].map(countRung));
  for (const [label, result] of [["warnings", warn], ["escalations", escalate], ["partner notices", partner], ["expiries", expire]] as const) {
    if (result.error) throw new Error(`Could not count ${label}: ${result.error.message}`);
  }

  const waits: number[] = [];
  let sampleCapped = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await client
      .from("lead_queue")
      .select("queued_at, claimed_at")
      .eq("tenant_id", tenantId)
      .not("partner_id", "is", null)
      .gte("claimed_at", since)
      .order("claimed_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (result.error) throw new Error(`Could not read claim times: ${result.error.message}`);
    const rows = (result.data ?? []) as Array<{ queued_at: string | null; claimed_at: string | null }>;
    for (const row of rows) {
      if (!row.queued_at || !row.claimed_at) continue;
      const seconds = (Date.parse(row.claimed_at) - Date.parse(row.queued_at)) / 1000;
      // A negative wait is a lead reopened after it was claimed: its queued_at moved past its claim.
      if (Number.isFinite(seconds) && seconds >= 0) waits.push(seconds);
    }
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1) sampleCapped = true;
  }

  waits.sort((a, b) => a - b);
  const middle = Math.floor(waits.length / 2);
  const median = waits.length === 0 ? null : waits.length % 2 ? waits[middle] : (waits[middle - 1] + waits[middle]) / 2;

  return {
    since,
    claimedInsideWarn: waits.filter((seconds) => seconds < warnAfterSeconds).length,
    claimed: waits.length,
    warned: warn.count ?? 0,
    escalated: escalate.count ?? 0,
    partnerTold: partner.count ?? 0,
    expired: expire.count ?? 0,
    medianClaimSeconds: median == null ? null : Math.round(median),
    sampleCapped,
  };
}

/**
 * Where the ladder stands right now: how long the longest-waiting inbound transfer has been
 * claimable, or null when nothing is waiting. The screen marks the rungs it has passed as done and
 * the next one as current — the board's stepper, drawn from the queue rather than from a sample.
 */
export async function getOldestWaitingSeconds(tenantId: string, now = new Date()): Promise<number | null> {
  const result = await db()
    .from("lead_queue")
    .select("queued_at")
    .eq("tenant_id", tenantId)
    .eq("status", "unclaimed")
    .not("partner_id", "is", null)
    .order("queued_at", { ascending: true })
    .limit(1);
  if (result.error) throw new Error(`Could not read the waiting transfers: ${result.error.message}`);
  const queuedAt = (result.data ?? [])[0]?.queued_at as string | undefined;
  if (!queuedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(queuedAt)) / 1000));
}

/** 20260924230400 applied: an expired transfer becomes a nurture lead. */
export async function nurtureOnExpiryReady(): Promise<boolean> {
  const probe = await db().from("lead_queue").select("nurtured_from_work_item_id").limit(1);
  return !probe.error;
}
