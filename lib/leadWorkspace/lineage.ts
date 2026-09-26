import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Where a lead came from and what it cost, and the next thing scheduled to happen to it — the two
 * facts the lead page's header and rail show that the workspace snapshot did not carry.
 *
 * Lineage is the lead's first source row (tenant_lead_sources: the campaign it arrived against, the
 * kind of source and what that row cost) plus the campaign's vendor — and, since LA-2.20-7, EVERY
 * source row. One person re-imported from a second vendor's list is one lead with two sources, each
 * with its own campaign and cost; reading only the first (`.limit(1)`) made the second vendor's
 * sale invisible on the lead page even though the cost reports counted it. Cost is money: the
 * caller says whether the viewer may see it, and when they may not it is never read, let alone
 * returned.
 *
 * The next action is the soonest open callback, else the cadence's next dial time. Either way it is
 * a time the product already acts on, not an estimate.
 */
export type LeadSource = {
  campaignId: string | null;
  campaignName: string | null;
  vendorName: string | null;
  sourceType: string | null;
  /** Null when the viewer may not see money, or nothing was recorded. */
  costCents: number | null;
  at: string | null;
};
export type LeadLineage = {
  vendorName: string | null;
  campaignName: string | null;
  campaignId: string | null;
  sourceType: string | null;
  /** Null when the viewer may not see money, or nothing was recorded. */
  costCents: number | null;
  costAt: string | null;
  money: boolean;
  /** Every source row, oldest first. The fields above are the first of them. */
  sources: LeadSource[];
  /** What every source together cost; null when money is hidden or no source has a cost. */
  totalCostCents: number | null;
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

/** A person bought from many vendors is still a handful of rows; this only bounds a runaway. */
const MAX_SOURCES = 50;

export async function leadLineageAndNext(tenantId: string, leadId: string, money: boolean): Promise<{ lineage: LeadLineage; nextAction: LeadNextAction }> {
  const db = getSupabaseServiceClient() as unknown as { from(table: string): Query };
  const now = new Date().toISOString();
  const [leadResult, sourceResult, callbackResult] = await Promise.all([
    db.from("agent_leads").select("campaign_id, next_dial_after").eq("tenant_id", tenantId).eq("id", leadId).limit(1),
    db.from("tenant_lead_sources").select(money ? "campaign_id, source_type, cost_cents, created_at" : "campaign_id, source_type, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: true }).limit(MAX_SOURCES),
    db.from("tenant_callbacks").select("scheduled_at_utc, customer_timezone").eq("tenant_id", tenantId).eq("lead_id", leadId).in("status", ["scheduled", "due"]).gte("scheduled_at_utc", now).order("scheduled_at_utc", { ascending: true }).limit(1),
  ]);
  const lead = leadResult.error ? undefined : (leadResult.data ?? [])[0];
  const sourceRows = sourceResult.error ? [] : sourceResult.data ?? [];

  // Every campaign named by a source (or by the lead itself, for a lead with no source row), and
  // their vendors, in one read each.
  const campaignIds = [...new Set([...sourceRows.map((row) => text(row.campaign_id)), text(lead?.campaign_id)].filter((id): id is string => Boolean(id)))];
  const campaigns = campaignIds.length
    ? await db.from("tenant_campaigns").select("id, name, vendor_id").eq("tenant_id", tenantId).in("id", campaignIds)
    : { data: [], error: null };
  const campaignById = new Map((campaigns.error ? [] : campaigns.data ?? []).map((row) => [String(row.id), row]));
  const vendorIds = [...new Set([...campaignById.values()].map((row) => text(row.vendor_id)).filter((id): id is string => Boolean(id)))];
  const vendors = vendorIds.length
    ? await db.from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId).in("id", vendorIds)
    : { data: [], error: null };
  const vendorName = new Map((vendors.error ? [] : vendors.data ?? []).map((row) => [String(row.id), text(row.name)]));
  const describe = (campaignId: string | null) => {
    const campaign = campaignId ? campaignById.get(campaignId) : undefined;
    const vendorId = text(campaign?.vendor_id);
    return { campaignName: text(campaign?.name), vendorName: vendorId ? vendorName.get(vendorId) ?? null : null };
  };

  const sources: LeadSource[] = sourceRows.map((row) => {
    const campaignId = text(row.campaign_id);
    return {
      campaignId,
      ...describe(campaignId),
      sourceType: text(row.source_type),
      costCents: money && row.cost_cents != null ? Number(row.cost_cents) : null,
      at: text(row.created_at),
    };
  });
  const first = sources[0];
  const campaignId = first?.campaignId ?? text(lead?.campaign_id);
  const { campaignName, vendorName: firstVendor } = describe(campaignId);
  const costs = sources.map((source) => source.costCents).filter((cost): cost is number => cost !== null);

  const callback = callbackResult.error ? undefined : (callbackResult.data ?? [])[0];
  const nextDial = text(lead?.next_dial_after);
  const nextAction: LeadNextAction = callback
    ? { kind: "callback", at: String(callback.scheduled_at_utc), timezone: String(callback.customer_timezone) }
    : nextDial && nextDial > now
      ? { kind: "dial", at: nextDial }
      : null;

  return {
    lineage: {
      vendorName: firstVendor,
      campaignName,
      campaignId,
      sourceType: first?.sourceType ?? null,
      costCents: first?.costCents ?? null,
      costAt: first?.at ?? null,
      money,
      sources,
      totalCostCents: money && costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    },
    nextAction,
  };
}
