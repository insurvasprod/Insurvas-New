import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

/**
 * LA-2.5-5 · speed to lead per campaign: "arrival -> first dial per vendor/campaign: median and
 * share within 60s". Reads tenant_campaign_speed_to_lead (20260925709720), which measures to the
 * lead's first Dial click rather than to the moment it was served.
 *
 * Same audience as the vendor rollup it sits beside (GET /api/app/vendors). Before the view exists
 * the answer is `pending: true` and no rows, never an error.
 */
const roles = ["owner", "producer"] as const;

type Loose = {
  from(table: string): {
    select(columns: string): { eq(column: string, value: unknown): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
  };
};

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", roles);
  if (auth instanceof NextResponse) return auth;
  const read = await (getSupabaseServiceClient() as unknown as Loose)
    .from("tenant_campaign_speed_to_lead")
    .select("campaign_id, campaign_name, vendor_id, posted_leads, dialled_leads, median_seconds, dialled_within_60s, dialled_within_60s_pct, last_posted_at")
    .eq("tenant_id", auth.context.tenantId);
  if (read.error) {
    if (isSchemaGap(read.error)) return NextResponse.json({ campaigns: [], pending: true }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: `Could not load speed to lead: ${read.error.message}` }, { status: 500 });
  }
  const rows = ((read.data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
    campaignId: String(row.campaign_id ?? ""),
    campaignName: String(row.campaign_name ?? ""),
    vendorId: String(row.vendor_id ?? ""),
    postedLeads: Number(row.posted_leads ?? 0),
    dialledLeads: Number(row.dialled_leads ?? 0),
    medianSeconds: row.median_seconds == null ? null : Number(row.median_seconds),
    dialledWithin60s: Number(row.dialled_within_60s ?? 0),
    dialledWithin60sPct: row.dialled_within_60s_pct == null ? null : Number(row.dialled_within_60s_pct),
    lastPostedAt: row.last_posted_at == null ? null : String(row.last_posted_at),
  })).sort((a, b) => b.postedLeads - a.postedLeads);
  return NextResponse.json({ campaigns: rows, pending: false }, { headers: { "Cache-Control": "no-store" } });
}
