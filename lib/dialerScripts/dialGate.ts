/**
 * The local dial gates that sit beside the calling window and the licence: the lead's campaign
 * (scrubbed and active), and the stored litigator evidence. Pure, so node --test can drive them.
 *
 * Owner decision 3 ("Sixteen Open Questions, Answered", LA-2.3): the check at serve and at dial
 * time never calls a vendor. It reads our own tables only — the internal DNC list, the stored
 * scrub hits (tenant_phone_suppression_hits: litigator, federal and state DNC), the import's stored
 * screening results, and the campaign's scrub status. A vendor outage blocks IMPORT, not dialling.
 *
 * Every dial goes through these, an inbound return call included. A return call skips the queue
 * (decision 1: nothing was served or claimed), never the compliance gates: a lead whose campaign is
 * paused or not scrubbed is no more callable because the customer rang first, and a litigator is a
 * litigator whoever dialled.
 */

export type CampaignGateRow = { status: string | null; scrubStatus: string | null };

export type DialGateRefusal = { reason: "campaign_not_servable" | "litigator_listed" | "policy_unavailable"; message: string };

/**
 * The campaign half of `campaigns_servable` (active AND scrubbed, 20260913290000), applied to one
 * lead at the dial. A lead with no campaign has no campaign gate: it came through partner intake or
 * a manual add, both screened per number at entry.
 */
export function campaignDialRefusal(input: { campaignId: string | null; campaign: CampaignGateRow | null; readFailed: boolean }): DialGateRefusal | null {
  if (!input.campaignId) return null;
  if (input.readFailed) return { reason: "policy_unavailable", message: "Dialing is blocked because this lead's campaign scrub status could not be verified." };
  if (!input.campaign) return { reason: "campaign_not_servable", message: "Dialing is blocked because this lead's campaign could not be found." };
  const status = input.campaign.status ?? "";
  if (status !== "active") {
    return { reason: "campaign_not_servable", message: `Dialing is blocked because this lead's campaign is ${status || "not active"}. Its leads are not called until it is active again.` };
  }
  switch (input.campaign.scrubStatus ?? "unscrubbed") {
    case "scrubbed":
      return null;
    case "scrubbing":
      return { reason: "campaign_not_servable", message: "Dialing is blocked because this lead's campaign is being scrubbed. Its leads are called again when the scrub finishes." };
    case "failed":
      return { reason: "campaign_not_servable", message: "Dialing is blocked because this lead's campaign failed its scrub. Its leads are not called until a scrub completes." };
    default:
      return { reason: "campaign_not_servable", message: "Dialing is blocked because this lead's campaign has not been scrubbed against the suppression lists." };
  }
}

/**
 * The import's stored litigator evidence for this number: the lead's own screening answer
 * (agent_leads.screening_outcome) or a litigator row in any of the tenant's scrub ledgers
 * (tenant_campaign_scrub_rejections). The suppression list's tcpa_litigator rows are read with the
 * other stored lists. A read that failed is never "clear".
 */
export function storedLitigatorRefusal(input: { leadScreeningOutcome: string | null; ledgerListed: boolean | null }): DialGateRefusal | null {
  if (input.leadScreeningOutcome === "tcpa_litigator" || input.ledgerListed === true) {
    return { reason: "litigator_listed", message: "Dialing is blocked because this number matched a TCPA litigator list when it was screened." };
  }
  if (input.ledgerListed === null) return { reason: "policy_unavailable", message: "Dialing is blocked because the stored litigator results could not be read." };
  return null;
}
