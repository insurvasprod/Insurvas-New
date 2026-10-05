// Pipeline stage sync (LA-3.23), pure. STATUS-MODEL §6 is the specification.
//
// The lead's card follows the MOST ADVANCED LIVE attempt, forward only — except `requoting`, the one
// deliberate step back (a decline that opened a new attempt). A card a person moved by hand stays
// where they put it; the board shows a reconcile hint instead. Nothing here ever changes an
// application: the board reads this, it never writes back.

import type { ApplicationOutcome, ApplicationStatus } from "./constants.ts";

export const SYNC_KEYS = ["quoted", "application_started", "submitted", "pending_requirements", "issued", "requoting", "lost"] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];

export const SYNC_KEY_LABEL: Record<SyncKey, string> = {
  quoted: "Quoted",
  application_started: "Application started",
  submitted: "Submitted",
  pending_requirements: "Pending requirements",
  issued: "Issued",
  requoting: "Back to quoting after a decline",
  lost: "Lost",
};

const RANK: Record<Exclude<SyncKey, "requoting" | "lost">, number> = { quoted: 1, application_started: 2, submitted: 3, pending_requirements: 4, issued: 5 };

export type SyncAttempt = { attemptNo: number; status: ApplicationStatus; outcome: ApplicationOutcome | null; hasQuote: boolean };

const DECLINED: readonly ApplicationOutcome[] = ["declined", "postponed", "declined_by_client", "offer_expired"];

function keyFor(a: SyncAttempt): SyncKey | null {
  if (a.status === "closed") return a.outcome === "issued" ? "issued" : null;
  if (a.status === "pending_carrier" || a.status === "counteroffer_pending") return "pending_requirements";
  if (a.status === "submitted") return "submitted";
  if (a.status === "ready") return "application_started";
  return a.hasQuote ? "quoted" : null;
}

/** Where the case's attempts say the lead belongs, or null when they say nothing. */
export function targetSyncKey(input: { caseStatus: "open" | "won" | "lost"; attempts: SyncAttempt[] }): SyncKey | null {
  if (input.caseStatus === "lost") return "lost";
  const keys = input.attempts.map(keyFor).filter((k): k is Exclude<SyncKey, "requoting" | "lost"> => k !== null && k !== "requoting" && k !== "lost");
  const best = keys.sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
  const live = input.attempts.filter((a) => a.status !== "closed");
  // A decline that opened a new attempt: that new attempt is still a bare draft, and the last
  // closed attempt before it was declined — the one allowed move backwards.
  if (best === null || best === "quoted") {
    const closed = input.attempts.filter((a) => a.status === "closed").sort((a, b) => b.attemptNo - a.attemptNo)[0];
    if (live.length && closed?.outcome && DECLINED.includes(closed.outcome)) return "requoting";
  }
  if (!best && !live.length) {
    const last = [...input.attempts].sort((a, b) => b.attemptNo - a.attemptNo)[0];
    if (last?.outcome === "withdrawn") return "lost";
  }
  return best;
}

/**
 * Should the sync move the card to `target`? Not when a person moved it by hand since the last sync,
 * and not backwards — `requoting` and `lost` excepted.
 */
export function shouldMove(input: { target: SyncKey; currentKey: SyncKey | null; lastHumanMoveAt: string | null; lastSyncAt: string | null; caseOpenedAt?: string | null }): { move: boolean; reason: "manual_override" | "backwards" | "already_there" | null } {
  // A move made before the case existed (the dialer's disposition that led to the sale) is not an
  // override of the application; only a move made since the case opened, and since the last sync, is.
  const human = input.lastHumanMoveAt && (!input.caseOpenedAt || input.lastHumanMoveAt > input.caseOpenedAt) ? input.lastHumanMoveAt : null;
  if (human && (!input.lastSyncAt || human > input.lastSyncAt)) return { move: false, reason: "manual_override" };
  if (input.currentKey === input.target) return { move: false, reason: "already_there" };
  if (input.target === "requoting" || input.target === "lost") return { move: true, reason: null };
  if (input.currentKey && input.currentKey in RANK && RANK[input.currentKey as keyof typeof RANK] > RANK[input.target as keyof typeof RANK]) return { move: false, reason: "backwards" };
  return { move: true, reason: null };
}

/**
 * Stage-history sources that are a person moving the card (STATUS-MODEL §6). 'inbound' is an agent's
 * inbound call outcome (complete_disposition, 20260925709870), a person's move like 'dialer'.
 */
export const HUMAN_STAGE_SOURCES = ["board", "table", "list", "lead_detail", "owner_fix", "dialer", "inbound"] as const;

/**
 * Which sync key the card's current stage stands for. Several keys can share a stage (requoting and
 * quoted both land on Quoted): the target wins when it is one of them, else the most advanced.
 */
export function currentSyncKey(stageId: string | null, map: Partial<Record<SyncKey, string>>, target: SyncKey | null): SyncKey | null {
  if (!stageId) return null;
  const keys = (Object.keys(map) as SyncKey[]).filter((key) => map[key] === stageId);
  if (!keys.length) return null;
  if (target && keys.includes(target)) return target;
  const ranked = keys.filter((key): key is keyof typeof RANK => key in RANK).sort((a, b) => RANK[b] - RANK[a]);
  return ranked[0] ?? keys[0];
}
