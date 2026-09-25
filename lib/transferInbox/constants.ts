// Shared by the inbox's client component and the server services, so no `server-only` here.

/**
 * A transfer an agent has and is still working: claimed, with a buffer assistant, being handed to
 * a licensed agent, or with one. What the inbox means by "Claimed" (20260924250000).
 */
export const WITH_AGENT_STATUSES = ["claimed", "buffer_active", "handed_pending", "la_active"] as const;

/** Waiting or with an agent -- everything not yet finished. The inbox RPC's `open` (20260924170000). */
export const OPEN_TRANSFER_STATUSES = ["unclaimed", ...WITH_AGENT_STATUSES] as const;

export function isWithAgent(status: string) {
  return (WITH_AGENT_STATUSES as readonly string[]).includes(status);
}

export function isOpenTransfer(status: string) {
  return (OPEN_TRANSFER_STATUSES as readonly string[]).includes(status);
}

/**
 * The screening pill an inbound row carries, from the three signals the inbox row holds.
 *
 *   dnc                                   -> Needs review  (the number is on a do-not-call list)
 *   internal_dq, or preflight found the
 *   household before (spoken_before /
 *   already_customer), or the legacy
 *   values.duplicate_warning flag         -> Duplicate
 *   clear                                 -> DNC clear
 *   anything else                         -> Not checked
 *
 * The order matters: a DNC hit outranks a duplicate, and a duplicate outranks "clear" (a clear DNC
 * check says nothing about whether the agency already has the customer). Agent Floor reads the same
 * rows and keeps its own risk logic; this is the inbox's one label.
 */
export type ScreeningSignalKey = "needs_review" | "duplicate" | "clear" | "not_checked";
export type ScreeningSignal = { key: ScreeningSignalKey; label: string; tone: "error" | "warning" | "success" | "neutral" };

export const SCREENING_SIGNALS: Record<ScreeningSignalKey, ScreeningSignal> = {
  needs_review: { key: "needs_review", label: "Needs review", tone: "error" },
  duplicate: { key: "duplicate", label: "Duplicate", tone: "warning" },
  clear: { key: "clear", label: "DNC clear", tone: "success" },
  not_checked: { key: "not_checked", label: "Not checked", tone: "neutral" },
};

export function screeningSignal(input: { screeningOutcome: string | null | undefined; preflightStatus?: string | null; duplicateWarning?: boolean | null }): ScreeningSignal {
  const outcome = (input.screeningOutcome ?? "").trim();
  if (outcome === "dnc") return SCREENING_SIGNALS.needs_review;
  if (outcome === "internal_dq" || input.preflightStatus === "spoken_before" || input.preflightStatus === "already_customer" || input.duplicateWarning === true) return SCREENING_SIGNALS.duplicate;
  if (outcome === "clear") return SCREENING_SIGNALS.clear;
  return SCREENING_SIGNALS.not_checked;
}

/** The values list_transfer_inbox filters screening on (agent_leads_screening_outcome_check, plus the fallback). */
export const SCREENING_FILTER_OPTIONS = [
  { value: "clear", label: "DNC clear" },
  { value: "dnc", label: "DNC hit" },
  { value: "internal_dq", label: "Internal DQ" },
  { value: "not_checked", label: "Not checked" },
] as const;

/** The KPI tiles: the tenant's whole open inbound set (list_transfer_inbox_bundle's `summary`, 20260924335200). */
export type InboxSummary = {
  waiting: number;
  longestWaitSeconds: number;
  averageWaitSeconds: number;
  claimed: number;
  claimedWithoutCall: number;
  needsReview: number;
};
