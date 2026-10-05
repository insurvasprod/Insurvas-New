// Shared by the inbox's client component and the server services, so no `server-only` here.

/**
 * A transfer an agent has and is still working: claimed, with a buffer assistant, being handed to
 * a licensed agent, or with one. What the inbox means by "Claimed" (20260924250000).
 */
export const WITH_AGENT_STATUSES = ["claimed", "buffer_active", "handed_pending", "la_active"] as const;

/** Waiting or with an agent -- everything not yet finished. The inbox RPC's `open` (20260924170000). */
export const OPEN_TRANSFER_STATUSES = ["unclaimed", ...WITH_AGENT_STATUSES] as const;

/**
 * LA-1.14's five states for a transfer, read from the stored status. The spec gives two words for
 * the licensed agent having the call: LA-1.10's claim stores `claimed` (a licensed agent took it
 * straight from the queue) and LA-1.14's handoff stores `la_active` (they took it from a buffer).
 * Both are the one state `la_active`. `completed`, `dropped`, `expired` and `closed` are all
 * `closed`. The stored values stay as they are: `claimed` is also the outbound dialer's served
 * state and the activity log's served trigger, so renaming it would break both for no gain.
 */
export const TRANSFER_PHASES = ["unclaimed", "buffer_active", "handed_pending", "la_active", "closed"] as const;
export type TransferPhase = (typeof TRANSFER_PHASES)[number];

export const TRANSFER_PHASE_LABEL: Record<TransferPhase, string> = {
  unclaimed: "Waiting",
  buffer_active: "With a buffer",
  handed_pending: "Being handed off",
  la_active: "With a licensed agent",
  closed: "Closed",
};

export function transferPhase(status: string): TransferPhase {
  if (status === "unclaimed" || status === "buffer_active" || status === "handed_pending") return status;
  if (status === "claimed" || status === "la_active") return "la_active";
  return "closed";
}

/** Two- and three-letter codes a form or a capacity row may carry instead of the name. */
export const LANGUAGE_CODES: Record<string, string> = { es: "spanish", en: "english", fr: "french", pt: "portuguese", zh: "chinese", vi: "vietnamese", ko: "korean", tl: "tagalog", ar: "arabic", ru: "russian", ht: "haitian creole" };

/**
 * One spelling for a language, whichever way it was written: "Spanish", "spanish", "es", "es-MX"
 * all read "spanish". The same reading as public.language_key (20260925709850), which decides who
 * may claim a caller (LA-1.14-10), so the Agent Floor's pairing hint and the database agree.
 */
export function languageKey(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/.test(v)) return LANGUAGE_CODES[v.split("-")[0].split("_")[0]] ?? v;
  return v;
}

/** "Spanish" for a language key the database returns ("spanish") or a code ("es"), for messages. */
export function languageName(key: string | null | undefined) {
  const value = languageKey(key);
  return value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "another language";
}

/**
 * The toast after a claim. `resumed` (the claim routes, 20260925709860) means the transfer had been
 * given back and this claim reopened the same verification session (LA-1.11-6).
 */
export function claimedMessage(body: { chatPosted?: boolean; resumed?: boolean } | null | undefined) {
  if (body?.resumed) return body.chatPosted === false ? "Transfer claimed and verification resumed; partner update could not be posted" : "Transfer claimed; verification resumed where it stopped";
  return body?.chatPosted === false ? "Transfer claimed; partner update could not be posted" : "Transfer claimed and call opened";
}

/** The three ways a transfer changes hands by hand (lib/transferInbox/release.ts, 20260925709860). */
export type ReleaseAction = "unassign" | "requeue" | "end_buffer";

/**
 * The confirmation each action asks for first, one wording for the inbox, the Agent Floor and the
 * lead page (LA-1.10-8, LA-1.14-9). Unassign and end-buffer are different acts and say so.
 */
export function releaseConfirmation(action: ReleaseAction, names: { customer?: string | null; bufferName?: string | null; agentName?: string | null } = {}) {
  const customer = names.customer?.trim() || "this transfer";
  if (action === "unassign") return `Give ${customer} back to the queue? Nobody will own it until someone claims it. The verification so far is kept for them.`;
  if (action === "requeue") return `Put ${customer} back in the queue? It waits again from now, and whoever claims it picks up the verification where it stopped.`;
  return `End ${names.bufferName?.trim() || "the buffer"}'s involvement? ${names.agentName?.trim() || "The licensed agent"} keeps the call and the verification. This does not unassign the transfer.`;
}

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
