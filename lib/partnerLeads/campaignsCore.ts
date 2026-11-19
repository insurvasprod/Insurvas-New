/**
 * Pure: a marketing partner's leads grouped by where they came from (roles board P2, "Campaigns").
 *
 * What a lead record stores today: `lead_queue.affiliate_campaign` (the campaign on a tracked link,
 * LA-1.8) and nothing else about a campaign — a lead sent through the portal form carries no campaign,
 * source or UTM field. So a lead is grouped by its campaign where one was stored, and otherwise by how
 * it arrived ("Portal form" or "Tracked link"), and the page says so. No campaign is invented.
 *
 * Form or call: the marketing pipeline's first two stages are "Form Lead" and "Call Lead" (LA-1.9).
 * A lead is counted as a call when its stage is the call stage; that is the only place the split is
 * recorded, so once a lead moves on it is counted where it entered — the form, the portal's intake.
 */
import { SALE_DISPOSITIONS } from "./lanes.ts";

export type CampaignLead = {
  campaign: string | null;
  viaLink: boolean;
  status: string;
  disposition: string | null;
  stageName: string | null;
};

export type CampaignGroup = {
  key: string;
  label: string;
  /** True when the label is a stored campaign; false when it is how the lead arrived. */
  stored: boolean;
  leads: number;
  form: number;
  call: number;
  contacted: number;
  converted: number;
  lost: number;
};

const SOLD = new Set<string>(SALE_DISPOSITIONS);
const LOST_STATUSES = new Set(["expired", "dropped"]);

export function isCallStage(stageName: string | null): boolean {
  return Boolean(stageName && /\bcall lead\b/i.test(stageName));
}

export function groupByCampaign(leads: readonly CampaignLead[]): CampaignGroup[] {
  const groups = new Map<string, CampaignGroup>();
  for (const lead of leads) {
    const name = lead.campaign?.trim();
    const key = name ? `campaign:${name.toLowerCase()}` : lead.viaLink ? "source:link" : "source:portal";
    const label = name || (lead.viaLink ? "Tracked link, no campaign" : "Portal form");
    const group = groups.get(key) ?? { key, label, stored: Boolean(name), leads: 0, form: 0, call: 0, contacted: 0, converted: 0, lost: 0 };
    group.leads += 1;
    if (isCallStage(lead.stageName)) group.call += 1;
    else group.form += 1;
    if (lead.status !== "unclaimed" && !LOST_STATUSES.has(lead.status)) group.contacted += 1;
    if (lead.status === "completed" && lead.disposition && SOLD.has(lead.disposition)) group.converted += 1;
    else if (LOST_STATUSES.has(lead.status) || lead.status === "completed") group.lost += 1;
    groups.set(key, group);
  }
  // Stored campaigns first, biggest first; the arrival groups after them.
  return [...groups.values()].sort((a, b) => Number(b.stored) - Number(a.stored) || b.leads - a.leads || a.label.localeCompare(b.label));
}

/** Whether any lead carried a stored campaign: when none did, the page says the grouping is by source. */
export function anyStoredCampaign(groups: readonly CampaignGroup[]): boolean {
  return groups.some((group) => group.stored);
}
