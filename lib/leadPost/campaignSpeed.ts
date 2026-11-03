/**
 * LA-2.5-5 · speed to lead per campaign, the arithmetic of tenant_campaign_speed_to_lead
 * (20260925709720) in TypeScript, for the route to use before that view is applied and for the
 * tests to pin. No imports: node --test loads it directly.
 *
 *   posted_leads            leads with a posted_at (real-time posts only; a list lead's arrival
 *                           time means nothing)
 *   dialled_leads           of those, the ones with at least one Dial click
 *   median_seconds          percentile_cont(0.5) of (first click − posted_at), over dialled leads only
 *   dialled_within_60s      first click within one minute of arrival
 *   dialled_within_60s_pct  that count over leads POSTED (not dialled), one decimal, so an ignored
 *                           lead counts against the campaign
 */

export type CampaignSpeedRow = {
  campaignId: string;
  campaignName: string;
  vendorId: string;
  postedLeads: number;
  dialledLeads: number;
  medianSeconds: number | null;
  dialledWithin60s: number;
  dialledWithin60sPct: number | null;
  lastPostedAt: string | null;
};

/** Postgres percentile_cont(0.5): the mean of the two middle values for an even count. */
export function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const low = sorted[Math.floor(middle)];
  const high = sorted[Math.ceil(middle)];
  return low + (high - low) * (middle - Math.floor(middle));
}

export function campaignSpeedToLead(
  leads: Array<{ id: string; campaignId: string; postedAt: string }>,
  clicks: Array<{ leadId: string; dialClickedAt: string }>,
  campaigns: Array<{ id: string; name: string; vendorId: string }>,
): CampaignSpeedRow[] {
  const firstClick = new Map<string, number>();
  for (const click of clicks) {
    const at = Date.parse(click.dialClickedAt);
    if (Number.isNaN(at)) continue;
    const seen = firstClick.get(click.leadId);
    if (seen === undefined || at < seen) firstClick.set(click.leadId, at);
  }
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const groups = new Map<string, { posted: number; seconds: number[]; within: number; last: number }>();
  for (const lead of leads) {
    const campaign = byId.get(lead.campaignId);
    const posted = Date.parse(lead.postedAt);
    if (!campaign || Number.isNaN(posted)) continue;
    const group = groups.get(campaign.id) ?? { posted: 0, seconds: [], within: 0, last: 0 };
    group.posted += 1;
    group.last = Math.max(group.last, posted);
    const clicked = firstClick.get(lead.id);
    if (clicked !== undefined) {
      const seconds = (clicked - posted) / 1000;
      group.seconds.push(seconds);
      if (seconds <= 60) group.within += 1;
    }
    groups.set(campaign.id, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const campaign = byId.get(id)!;
    return {
      campaignId: id,
      campaignName: campaign.name,
      vendorId: campaign.vendorId,
      postedLeads: group.posted,
      dialledLeads: group.seconds.length,
      medianSeconds: medianOf(group.seconds),
      dialledWithin60s: group.within,
      dialledWithin60sPct: group.posted ? Math.round((1000 * group.within) / group.posted) / 10 : null,
      lastPostedAt: group.last ? new Date(group.last).toISOString() : null,
    };
  }).sort((a, b) => b.postedLeads - a.postedLeads);
}
