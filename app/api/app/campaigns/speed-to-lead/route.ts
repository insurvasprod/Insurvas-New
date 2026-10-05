import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { campaignSpeedToLead, type CampaignSpeedRow } from "@/lib/leadPost/campaignSpeed";

/**
 * LA-2.5-5 · speed to lead per campaign: "arrival -> first dial per vendor/campaign: median and
 * share within 60s", measured to the lead's first Dial click (tenant_call_attempts.dial_clicked_at,
 * which 20260925711500 also makes agent_leads.first_dial_at).
 *
 * Reads tenant_campaign_speed_to_lead (20260925709720) when it exists. Before that view is applied
 * the same figures are computed here from the same two tables with the same arithmetic
 * (lib/leadPost/campaignSpeed.ts), so the roster is right on either side of the migration.
 *
 * Same audience as the vendor rollup it sits beside (GET /api/app/vendors).
 */
const roles = ["owner", "producer"] as const;

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Q = PromiseLike<Result> & {
  select(columns: string): Q;
  eq(column: string, value: unknown): Q;
  in(column: string, values: unknown[]): Q;
  not(column: string, operator: string, value: unknown): Q;
  range(from: number, to: number): Q;
};
type Loose = { from(table: string): Q };

const rowsOf = (result: Result) => (Array.isArray(result.data) ? (result.data as Array<Record<string, unknown>>) : []);

/** Every row of a read, 1,000 at a time (PostgREST's page size). */
async function all(read: (from: number, to: number) => Q): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    const page = await read(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    const rows = rowsOf(page);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function computed(db: Loose, tenantId: string): Promise<CampaignSpeedRow[]> {
  const [leads, campaigns] = await Promise.all([
    all((from, to) => db.from("agent_leads").select("id, campaign_id, posted_at").eq("tenant_id", tenantId).not("posted_at", "is", null).not("campaign_id", "is", null).range(from, to)),
    all((from, to) => db.from("tenant_campaigns").select("id, name, vendor_id").eq("tenant_id", tenantId).range(from, to)),
  ]);
  const ids = leads.map((lead) => String(lead.id));
  const clicks: Array<Record<string, unknown>> = [];
  for (let index = 0; index < ids.length; index += 200) {
    const slice = ids.slice(index, index + 200);
    clicks.push(...await all((from, to) => db.from("tenant_call_attempts").select("lead_id, dial_clicked_at").eq("tenant_id", tenantId).in("lead_id", slice).not("dial_clicked_at", "is", null).range(from, to)));
  }
  return campaignSpeedToLead(
    leads.map((lead) => ({ id: String(lead.id), campaignId: String(lead.campaign_id), postedAt: String(lead.posted_at) })),
    clicks.map((click) => ({ leadId: String(click.lead_id), dialClickedAt: String(click.dial_clicked_at) })),
    campaigns.map((campaign) => ({ id: String(campaign.id), name: String(campaign.name ?? ""), vendorId: String(campaign.vendor_id ?? "") })),
  );
}

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", roles);
  if (auth instanceof NextResponse) return auth;
  const db = getSupabaseServiceClient() as unknown as Loose;
  const read = await db
    .from("tenant_campaign_speed_to_lead")
    .select("campaign_id, campaign_name, vendor_id, posted_leads, dialled_leads, median_seconds, dialled_within_60s, dialled_within_60s_pct, last_posted_at")
    .eq("tenant_id", auth.context.tenantId);
  try {
    if (read.error) {
      if (!isSchemaGap(read.error)) return NextResponse.json({ error: `Could not load speed to lead: ${read.error.message}` }, { status: 500 });
      const rows = await computed(db, auth.context.tenantId);
      return NextResponse.json({ campaigns: rows, source: "computed" }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    return NextResponse.json({ error: `Could not load speed to lead: ${error instanceof Error ? error.message : "unknown"}` }, { status: 500 });
  }
  const rows: CampaignSpeedRow[] = rowsOf(read).map((row) => ({
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
  return NextResponse.json({ campaigns: rows, source: "view" }, { headers: { "Cache-Control": "no-store" } });
}
