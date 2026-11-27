import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getLeadRecord } from "@/lib/leadWorkspace/record";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardLead } from "@/lib/agency/guards";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

async function leadCampaignName(tenantId: string, leadId: string): Promise<string | null> {
  try {
    // agent_leads.campaign_id is not in the generated types; read loosely, as lineage.ts does.
    type One = PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
    type Read = { select(c: string): { eq(c: string, v: string): { eq(c: string, v: string): { maybeSingle(): One } } } };
    const db = getSupabaseServiceClient() as unknown as { from(table: string): Read };
    const lead = await db.from("agent_leads").select("campaign_id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
    const campaignId = typeof lead.data?.campaign_id === "string" ? lead.data.campaign_id : null;
    if (lead.error || !campaignId) return null;
    const campaign = await db.from("tenant_campaigns").select("name").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle();
    return !campaign.error && typeof campaign.data?.name === "string" ? campaign.data.name : null;
  } catch {
    return null;
  }
}

/**
 * The lead's record tabs — Attempts, Callbacks and Nurture — read when a tab opens. Read-only, and
 * the same gate as the lead itself (`leads/[id]`): whoever can open the lead can read its record.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardLead(auth.context, id);
  if (hidden) return hidden;
  try {
    // The campaign whose cadence the lead runs on, by name (the phone's Nurture plan title, 2026-11-26,
    // additive); null when the read fails or the lead has no campaign.
    const [record, campaignName] = await Promise.all([getLeadRecord(auth.context.tenantId, id), leadCampaignName(auth.context.tenantId, id)]);
    return NextResponse.json({ ...record, campaignName }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load this lead's record";
    return NextResponse.json({ error: message }, { status: message === "Lead not found" ? 404 : 500 });
  }
}
