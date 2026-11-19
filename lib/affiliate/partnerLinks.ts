import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-1.8 · the affiliate's own tracked links, as the partner portal shows them (roles board P3, "My
 * links"). Read-only: creating, pausing and naming links stays the agency's (affiliate-links-panel).
 *
 * Scoped twice, from the session only: the tenant and the partner. A link of another partner — in
 * this agency or any other — is never read, and neither is any partner's name. What a link carries
 * back is its own slug, campaign, state and counts; never the agency's ids for anything else.
 *
 * Referrals per link are counted from the queue rows that carry the link (lead_queue.affiliate_link_id,
 * written at intake by the public /affiliate route), under the same tenant and partner. Opening this
 * page never counts a click: the click counter moves only in record_affiliate_link_click.
 */
export type PartnerOwnLink = {
  id: string;
  slug: string;
  campaign: string | null;
  isActive: boolean;
  clicks: number;
  referrals: number;
  createdAt: string;
};

export async function listPartnerOwnLinks(tenantId: string, partnerId: string): Promise<PartnerOwnLink[]> {
  const db = getSupabaseServiceClient();
  const [links, attributed] = await Promise.all([
    db.from("affiliate_links")
      .select("id, slug, campaign, is_active, click_count, created_at")
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false })
      .limit(200),
    db.from("lead_queue")
      .select("affiliate_link_id")
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .not("affiliate_link_id", "is", null)
      .limit(20000),
  ]);
  if (links.error) throw new Error(`Could not load your links: ${links.error.message}`);
  // The counts are a second, optional read: a failure leaves the links up with no referral figure.
  const perLink = new Map<string, number>();
  if (!attributed.error) {
    for (const row of (attributed.data ?? []) as Array<{ affiliate_link_id: string | null }>) {
      if (row.affiliate_link_id) perLink.set(row.affiliate_link_id, (perLink.get(row.affiliate_link_id) ?? 0) + 1);
    }
  }
  return ((links.data ?? []) as Array<{ id: string; slug: string; campaign: string | null; is_active: boolean; click_count: number | string; created_at: string }>).map((row) => ({
    id: row.id,
    slug: row.slug,
    campaign: typeof row.campaign === "string" && row.campaign.trim() ? row.campaign : null,
    isActive: Boolean(row.is_active),
    clicks: Number(row.click_count ?? 0),
    referrals: attributed.error ? -1 : perLink.get(row.id) ?? 0,
    createdAt: row.created_at,
  }));
}
