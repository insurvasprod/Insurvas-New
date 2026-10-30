import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isMissingSchema } from "./schemaGap";
import type { PostActivity, RecentPost, VendorRejection } from "./types";

/**
 * Lead posting · what arrived (owner pick A, 2026-10-30). The post log has been written on every post
 * since LA-2.5 and never shown: the screen counted it and stopped there. This reads it back two ways:
 *
 *   recent      the newest posts, accepted or rejected, with the reason and how long the post took.
 *               Never `raw_payload`: it is the person's details as the vendor sent them, and the
 *               accepted ones are a click away on the lead itself.
 *   byVendor    rejections per vendor and reason over the same 30 days the key figures use, so each
 *               vendor's panel can say why ITS posts bounced, not the workspace's.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Q = PromiseLike<Result> & {
  select(columns: string): Q;
  eq(column: string, value: unknown): Q;
  gte(column: string, value: unknown): Q;
  order(column: string, options?: { ascending?: boolean }): Q;
  limit(n: number): Q;
  range(from: number, to: number): Q;
};
type Loose = { from(table: string): Q };

const WINDOW_DAYS = 30;
/** Enough to read the last hour of a busy vendor; the panel lists a vendor's own from these. */
const RECENT = 100;
/** Rejected rows read for the per-vendor split; a window with more is reported as capped. */
const REJECTED_CAP = 10_000;

const rowsOf = (result: Result) => (Array.isArray(result.data) ? (result.data as Array<Record<string, unknown>>) : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");

export async function postActivity(tenantId: string): Promise<PostActivity> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const log = () => db.from("tenant_lead_post_log");

  // key_id arrives with 20260924130000; read without it when the column is missing.
  const recentRead = async (columns: string) => log().select(columns).eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(RECENT);
  let recent = await recentRead("received_at, vendor_id, key_id, campaign_id, outcome, reason_code, processing_ms, lead_id");
  if (recent.error && isMissingSchema(recent.error)) recent = await recentRead("received_at, vendor_id, campaign_id, outcome, reason_code, processing_ms, lead_id");
  if (recent.error) throw new Error(`Could not load recent posts: ${recent.error.message}`);

  const rejected: Array<Record<string, unknown>> = [];
  let capped = false;
  for (let from = 0; ; from += 1000) {
    const page = await log().select("vendor_id, reason_code").eq("tenant_id", tenantId).eq("outcome", "rejected").gte("received_at", since).range(from, from + 999);
    if (page.error) throw new Error(`Could not load rejections: ${page.error.message}`);
    const rows = rowsOf(page);
    rejected.push(...rows);
    if (rows.length < 1000) break;
    if (rejected.length >= REJECTED_CAP) { capped = true; break; }
  }

  const tally = new Map<string, VendorRejection>();
  for (const row of rejected) {
    const vendorId = text(row.vendor_id);
    const reasonCode = text(row.reason_code);
    if (!vendorId || !reasonCode) continue;
    const key = `${vendorId}|${reasonCode}`;
    const entry = tally.get(key) ?? { vendorId, reasonCode, count: 0 };
    entry.count += 1;
    tally.set(key, entry);
  }

  return {
    recent: rowsOf(recent).map((row): RecentPost => ({
      receivedAt: text(row.received_at),
      vendorId: text(row.vendor_id) || null,
      keyId: text(row.key_id) || null,
      campaignId: text(row.campaign_id) || null,
      outcome: text(row.outcome),
      reasonCode: text(row.reason_code),
      processingMs: typeof row.processing_ms === "number" ? row.processing_ms : null,
      leadId: text(row.lead_id) || null,
    })),
    byVendor: [...tally.values()].sort((a, b) => b.count - a.count),
    capped,
    windowDays: WINDOW_DAYS,
  };
}
