import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Where a lead came from and what it cost, and the next thing scheduled to happen to it — the two
 * facts the lead page's header and rail show that the workspace snapshot did not carry.
 *
 * Lineage is the lead's first source row (tenant_lead_sources: the campaign it arrived against, the
 * kind of source and what that row cost) plus the campaign's vendor. Cost is money: the caller says
 * whether the viewer may see it, and when they may not it is never read, let alone returned.
 *
 * The next action is the soonest open callback, else the cadence's next dial time. Either way it is
 * a time the product already acts on, not an estimate.
 */
export type LeadLineage = {
  vendorName: string | null;
  campaignName: string | null;
  campaignId: string | null;
  sourceType: string | null;
  /** Null when the viewer may not see money, or nothing was recorded. */
  costCents: number | null;
  costAt: string | null;
  money: boolean;
};
export type LeadNextAction = { kind: "callback"; at: string; timezone: string } | { kind: "dial"; at: string } | null;

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  gte(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
};

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

export async function leadLineageAndNext(tenantId: string, leadId: string, money: boolean): Promise<{ lineage: LeadLineage; nextAction: LeadNextAction }> {
  const db = getSupabaseServiceClient() as unknown as { from(table: string): Query };
  const now = new Date().toISOString();
  const [leadResult, sourceResult, callbackResult] = await Promise.all([
    db.from("agent_leads").select("campaign_id, next_dial_after").eq("tenant_id", tenantId).eq("id", leadId).limit(1),
    db.from("tenant_lead_sources").select(money ? "campaign_id, source_type, cost_cents, created_at" : "campaign_id, source_type, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: true }).limit(1),
    db.from("tenant_callbacks").select("scheduled_at_utc, customer_timezone").eq("tenant_id", tenantId).eq("lead_id", leadId).in("status", ["scheduled", "due"]).gte("scheduled_at_utc", now).order("scheduled_at_utc", { ascending: true }).limit(1),
  ]);
  const lead = leadResult.error ? undefined : (leadResult.data ?? [])[0];
  const source = sourceResult.error ? undefined : (sourceResult.data ?? [])[0];
  const campaignId = text(source?.campaign_id) ?? text(lead?.campaign_id);

  let campaignName: string | null = null;
  let vendorName: string | null = null;
  if (campaignId) {
    const campaign = await db.from("tenant_campaigns").select("name, vendor_id").eq("tenant_id", tenantId).eq("id", campaignId).limit(1);
    const row = campaign.error ? undefined : (campaign.data ?? [])[0];
    campaignName = text(row?.name);
    const vendorId = text(row?.vendor_id);
    if (vendorId) {
      const vendor = await db.from("tenant_lead_vendors").select("name").eq("tenant_id", tenantId).eq("id", vendorId).limit(1);
      vendorName = vendor.error ? null : text((vendor.data ?? [])[0]?.name);
    }
  }

  const callback = callbackResult.error ? undefined : (callbackResult.data ?? [])[0];
  const nextDial = text(lead?.next_dial_after);
  const nextAction: LeadNextAction = callback
    ? { kind: "callback", at: String(callback.scheduled_at_utc), timezone: String(callback.customer_timezone) }
    : nextDial && nextDial > now
      ? { kind: "dial", at: nextDial }
      : null;

  return {
    lineage: {
      vendorName,
      campaignName,
      campaignId,
      sourceType: text(source?.source_type),
      costCents: money && source?.cost_cents != null ? Number(source.cost_cents) : null,
      costAt: text(source?.created_at),
      money,
    },
    nextAction,
  };
}
