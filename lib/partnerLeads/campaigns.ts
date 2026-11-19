import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { anyStoredCampaign, groupByCampaign, type CampaignGroup, type CampaignLead } from "./campaignsCore";

/**
 * Roles board P2 · a marketing partner's leads by campaign (campaignsCore.ts says what is grouped by
 * what, and why). Partner-scoped exactly as Lead Pipeline is: tenant and partner from the session, and
 * only the submitters this viewer may see (lib/partnerAuth/team.ts visibleSubmitters), so a partner
 * user sees their own leads' campaigns and an admin their team's. Counts only — no lead, no customer,
 * no agency figure leaves this read.
 */
export type PartnerCampaigns = { groups: CampaignGroup[]; byCampaign: boolean; total: number; truncated: boolean };

const LIMIT = 5000;

type CampaignRow = { status: string; disposition: string | null; affiliate_campaign: string | null; affiliate_link_id: string | null; pipeline_id: string | null; stage_id: string | null };
const COLUMNS = "status, disposition, affiliate_campaign, affiliate_link_id, pipeline_id, stage_id, agent_leads!inner(created_by)";

/**
 * `withLinkReferrals` (a partner admin, as in the pipeline read model 20261119100000) also counts the
 * leads that came through this partner's own tracked links, which have no submitter.
 */
export async function partnerCampaigns(tenantId: string, partnerId: string, visibleSubmitterIds: readonly string[], range: { from: string; to: string }, withLinkReferrals = false): Promise<PartnerCampaigns> {
  // An empty list matches nothing, never everyone (the pipeline read model's rule).
  if (!visibleSubmitterIds.length) return { groups: [], byCampaign: false, total: 0, truncated: false };
  const db = getSupabaseServiceClient();
  const until = new Date(Date.parse(range.to) + 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("lead_queue")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .in("agent_leads.created_by", [...visibleSubmitterIds])
    .gte("queued_at", range.from)
    .lt("queued_at", until)
    .order("queued_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(`Could not load your campaigns: ${error.message}`);
  const rows = [...((data ?? []) as unknown as CampaignRow[])];
  if (withLinkReferrals) {
    const links = await db.from("affiliate_links").select("id").eq("tenant_id", tenantId).eq("partner_id", partnerId);
    if (links.error) throw new Error(`Could not load your campaigns: ${links.error.message}`);
    const linkIds = ((links.data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (linkIds.length) {
      const viaLinks = await db
        .from("lead_queue")
        .select(COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("partner_id", partnerId)
        .in("affiliate_link_id", linkIds)
        .is("agent_leads.created_by", null)
        .gte("queued_at", range.from)
        .lt("queued_at", until)
        .order("queued_at", { ascending: false })
        .limit(LIMIT);
      if (viaLinks.error) throw new Error(`Could not load your campaigns: ${viaLinks.error.message}`);
      rows.push(...((viaLinks.data ?? []) as unknown as CampaignRow[]));
    }
  }

  // Stage names, for the form / call split: tenant-scoped pipelines first, then only their stages.
  const pipelineIds = [...new Set(rows.map((row) => row.pipeline_id).filter((id): id is string => Boolean(id)))];
  const stageNames = new Map<string, string>();
  if (pipelineIds.length) {
    const pipelines = await db.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).in("id", pipelineIds);
    const ownIds = ((pipelines.data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (ownIds.length) {
      const stages = await db.from("tenant_pipeline_stages").select("id, name").in("pipeline_id", ownIds);
      for (const stage of (stages.data ?? []) as Array<{ id: string; name: string }>) stageNames.set(stage.id, stage.name);
    }
  }

  const leads: CampaignLead[] = rows.map((row) => ({
    campaign: row.affiliate_campaign,
    viaLink: Boolean(row.affiliate_link_id),
    status: row.status,
    disposition: row.disposition,
    stageName: row.stage_id ? stageNames.get(row.stage_id) ?? null : null,
  }));
  const groups = groupByCampaign(leads);
  return { groups, byCampaign: anyStoredCampaign(groups), total: leads.length, truncated: rows.length >= LIMIT };
}
