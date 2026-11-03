import { notify } from "@/lib/notify";

/**
 * Lead sources clean-up (owner 2026-10-29): deleting an empty campaign, shared by the campaign's
 * side panel (Source) and the Lists table. The server (DELETE /api/app/campaigns/[id]) is the judge:
 * it checks every table that points at a campaign and answers a 409 with the reason and the way out.
 * The screens only grey the action out when they can already see the reason (leads arrived).
 */
export const CAMPAIGN_HAS_LEADS = "It has leads — mark it exhausted instead.";

/** Why the screen already knows the campaign cannot go, or null when only the server can tell. */
export function campaignDeleteBlocked(leadsIn: number | null | undefined): string | null {
  return leadsIn != null && leadsIn > 0 ? CAMPAIGN_HAS_LEADS : null;
}

/** One DELETE; true when the campaign is gone. A refusal is said in a toast, in the server's words. */
export async function deleteCampaign(id: string, name: string): Promise<boolean> {
  const response = await fetch(`/api/app/campaigns/${id}`, { method: "DELETE" }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) {
    notify.block(body?.error ?? `Could not delete ${name}`);
    return false;
  }
  notify.done(`${name} deleted`);
  return true;
}
