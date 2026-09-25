// Campaign vocabulary shared by the campaigns screen (a client component) and the server code that
// feeds it. Plain module on purpose — no `server-only` — so the client can import the labels and
// the pure rules without pulling a service module across the boundary (tsc would not catch it;
// only `next build` does).

/** tenant_campaigns.status, in the order the list sorts: the ones that need something done first. */
export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "exhausted"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  exhausted: "Exhausted",
};

export const CAMPAIGN_STATUS_ORDER: Record<string, number> = { draft: 0, active: 1, paused: 2, exhausted: 3 };

/**
 * tenant_campaigns.scrub_status. The check constraint (20260913290000) allows exactly these four;
 * the screen used to map `pending` and `running`, which the database never holds, so a campaign
 * mid-scrub showed the raw word "scrubbing".
 */
export const SCRUB_LABEL: Record<string, string> = {
  unscrubbed: "Not scrubbed",
  scrubbing: "Scrubbing",
  scrubbed: "Scrubbed",
  failed: "Scrub failed",
};

/** A campaign serves leads only when it is active AND scrubbed (campaigns_servable). */
export function campaignServes(status: string, scrubStatus: string | null | undefined) {
  return status === "active" && scrubStatus === "scrubbed";
}

/**
 * Why an active or draft campaign will not serve once it is active, or null when it will. Worded as
 * the rule, not a warning: the queue does not hand these leads out.
 */
export function scrubGateReason(scrubStatus: string | null | undefined): string | null {
  switch (scrubStatus ?? "unscrubbed") {
    case "scrubbed":
      return null;
    case "scrubbing":
      return "is being scrubbed, so none of its leads is served until the scrub finishes.";
    case "failed":
      return "failed its scrub, so none of its leads is served until a scrub completes.";
    default:
      return "has not been scrubbed, so none of its leads is servable.";
  }
}

/** A run with no progress for this long can be picked up by another window (20260925706100). */
export const SCRUB_STALE_MINUTES = 15;

/** Leads screened per request. Small enough that one request finishes well inside a timeout. */
export const SCRUB_BATCH_SIZE = 25;

export type ScrubRun = {
  id: string;
  campaign_id: string;
  status: "running" | "scrubbed" | "failed";
  total_leads: number;
  processed_leads: number;
  rejected_leads: number;
  suppressed_numbers: number;
  started_at: string;
  last_progress_at: string;
  finished_at: string | null;
  error: string | null;
};

/** Minutes since a run last moved, for "stopped making progress N minutes ago". */
export function minutesSince(iso: string, now: number = Date.now()) {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60_000)) : null;
}

/** True when a running run has gone quiet long enough that it can be resumed from another window. */
export function scrubRunIsStale(run: Pick<ScrubRun, "status" | "last_progress_at">, now: number = Date.now()) {
  const minutes = minutesSince(run.last_progress_at, now);
  return run.status === "running" && minutes !== null && minutes >= SCRUB_STALE_MINUTES;
}

/** The screening outcomes a re-scrub acts on, and what each one does. */
export type ScrubOutcomeAction = "clear" | "suppress" | "reject" | "outage";

/**
 * Same classification as the import (lib/agentTemplates/service.ts): a litigator or DNC hit is a row
 * that can never be dialled — recorded in the rejection ledger AND written to the suppression list,
 * because unlike an import the lead already exists and would otherwise stay servable. An invalid
 * number is a rejection with nothing to suppress. `unavailable` is an outage: we do not know whether
 * the number is safe, so the run stops rather than passing it. `internal_dq` (the agency already
 * has this person) is not a rejection.
 */
export function scrubOutcomeAction(outcome: string): ScrubOutcomeAction {
  if (outcome === "tcpa_litigator" || outcome === "dnc") return "suppress";
  if (outcome === "invalid_phone") return "reject";
  if (outcome === "unavailable") return "outage";
  return "clear";
}

/** The ledger's outcome vocabulary (tenant_campaign_scrub_rejections.outcome). */
export function ledgerOutcome(outcome: string): "dnc" | "tcpa_litigator" | "invalid" {
  if (outcome === "tcpa_litigator") return "tcpa_litigator";
  if (outcome === "invalid_phone") return "invalid";
  return "dnc";
}

/** Progress per campaign (tenant_campaign_progress, 20260925706000). */
export type CampaignProgress = {
  leads_received: number;
  leads_dialed: number;
  leads_workable: number;
  leads_exhausted: number;
  first_import_at: string | null;
  last_import_at: string | null;
  own_cadence_rules: number;
};

/** "Worked" is leads dialled at least once over leads received. Null when nothing was received. */
export function workedPercent(progress: Pick<CampaignProgress, "leads_received" | "leads_dialed"> | null | undefined) {
  if (!progress || progress.leads_received <= 0) return null;
  return Math.round((100 * progress.leads_dialed) / progress.leads_received);
}

/**
 * The hint the board's "Exhausted" state becomes. No status change is made: an owner decides, with
 * "Mark exhausted". Shown when leads arrived and none is fresh, working or waiting on a retry.
 */
export function hasNoWorkableLeads(progress: Pick<CampaignProgress, "leads_received" | "leads_workable"> | null | undefined) {
  return Boolean(progress && progress.leads_received > 0 && progress.leads_workable === 0);
}
