/**
 * LA-5.3 (Notion sprint) · who is on the save queue, and in what order, as plain functions.
 *
 *   · In force, NOT past due, at or above the queue band. Anything actually past due — anything on
 *     LA-4.16's call list — belongs there, not here: if an emergency shows on both boards the agent
 *     cannot tell prediction from emergency, and the emergency loses. (A mailed bill on 4.16 is
 *     prevention, not an emergency, so it does not keep a policy off this queue.)
 *   · A worked card leaves for the cooldown and returns early only if the score rose.
 *   · A snooze holds until its day; a dismissal until released. Either returns if the score rises.
 *   · Default order: score × advance at risk, descending — neither alone is right.
 *
 * Pure; relative imports only.
 */

import { BANDS, type Band, type Confidence, type RetentionSettings } from "./constants.ts";

export const SORTS = ["value", "score", "exposure", "next_draft", "months"] as const;
export type QueueSort = (typeof SORTS)[number];
export const SORT_LABELS: Record<QueueSort, string> = {
  value: "Risk × money (default)",
  score: "Risk score",
  exposure: "Advance at risk",
  next_draft: "Days until next draft",
  months: "Months since issue",
};

const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/** Days from `today` to the next time `draftDay` comes round (0 = today). A day past a short month's end drafts on its last day. */
export function daysUntilNextDraft(draftDay: number | null, today: string): number | null {
  if (!draftDay) return null;
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7);
  const lastOf = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const thisMonth = `${today.slice(0, 7)}-${String(Math.min(draftDay, lastOf(y, m))).padStart(2, "0")}`;
  if (thisMonth >= today) return dayNumber(thisMonth) - dayNumber(today);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const next = `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(draftDay, lastOf(ny, nm))).padStart(2, "0")}`;
  return dayNumber(next) - dayNumber(today);
}

export const bandAtLeast = (band: Band, min: Band) => BANDS.indexOf(band) >= BANDS.indexOf(min);

export type QueueCandidate = {
  key: string;
  score: number;
  band: Band;
  confidence: Confidence;
  status: string | null;
  daysPastDue: number | null;
  /** The LA-4.16 reason this policy is on the call list, if it is. */
  boardReason: string | null;
  lastAttempt: { at: string; score: number } | null;
  hold: { kind: "snooze" | "dismiss"; until: string | null; score: number } | null;
  atRiskCents: number | null;
  nextDraftDays: number | null;
  monthsSinceIssue: number | null;
  /** LA-5.4: a fix the next file did not show, with its reason. Such a policy is back on the queue, first. */
  failedFix?: string | null;
  /** LA-5.5: the paper-bill campaign found no bank account. It is on the queue whatever its score, so the risk decides what else to try. */
  noBankAccount?: boolean;
};

const IN_FORCE = new Set(["active", "approved_unpaid"]);

/** On the call list for a real reason (anything but prevention), or past due: that board's, not this one's. */
export const isEmergency = (c: Pick<QueueCandidate, "status" | "daysPastDue" | "boardReason">) =>
  !IN_FORCE.has(c.status ?? "") || (c.daysPastDue ?? 0) > 0 || (c.boardReason !== null && c.boardReason !== "direct_bill");

export function isHeld(c: Pick<QueueCandidate, "hold" | "lastAttempt" | "score">, today: string, cooldownDays: number): boolean {
  if (c.hold && c.score <= c.hold.score && (c.hold.kind === "dismiss" || (c.hold.until !== null && c.hold.until > today))) return true;
  if (c.lastAttempt && c.score <= c.lastAttempt.score && dayNumber(today) - dayNumber(c.lastAttempt.at.slice(0, 10)) < cooldownDays) return true;
  return false;
}

export function compareCards(sort: QueueSort) {
  return (a: QueueCandidate, b: QueueCandidate): number => {
    const value = (c: QueueCandidate) => c.score * (c.atRiskCents ?? 0);
    const primary =
      sort === "value" ? value(b) - value(a)
      : sort === "score" ? b.score - a.score
      : sort === "exposure" ? (b.atRiskCents ?? -1) - (a.atRiskCents ?? -1)
      : sort === "next_draft" ? (a.nextDraftDays ?? Infinity) - (b.nextDraftDays ?? Infinity)
      : (a.monthsSinceIssue ?? Infinity) - (b.monthsSinceIssue ?? Infinity);
    return primary || b.score - a.score || (b.atRiskCents ?? -1) - (a.atRiskCents ?? -1) || a.key.localeCompare(b.key);
  };
}

/**
 * A low-confidence score (under half the weight known) stays scored but never reaches the queue
 * (owner decision 2026-10-14, beyond the Notion spec). On an imported book the radar knows only how a
 * policy pays and its month, and those two alone put 1,041 of 1,408 policies at high or critical, nearly
 * every card reading "Month 3." The ones held back are counted, so the queue says what it left out.
 */
export const reachesQueue = (c: Pick<QueueCandidate, "confidence">) => c.confidence !== "low";

/** The queue: eligible cards in order, capped. With nothing at the queue band, medium fills it when the setting says so. */
export function buildQueue<T extends QueueCandidate>(all: T[], settings: RetentionSettings, today: string, sort: QueueSort = "value"): { cards: T[]; total: number; usedMedium: boolean; lowConfidence: number } {
  // A fix the file did not show is back whatever its band, confidence or hold — never over an emergency.
  const failed = all.filter((c) => c.failedFix && !isEmergency(c));
  const failedKeys = new Set(failed.map((c) => c.key));
  const open = all.filter((c) => !failedKeys.has(c.key) && !isEmergency(c) && !isHeld(c, today, settings.workedCooldownDays));
  const atBand = (c: T) => bandAtLeast(c.band, settings.queueMinBand);
  // Counted against the queue band, so the number means "would be on the queue if more were known".
  const lowConfidence = open.filter((c) => atBand(c) && !reachesQueue(c) && !c.noBankAccount).length;
  const known = open.filter(reachesQueue);
  // Sent from the paper-bill campaign: on the queue whatever its band or confidence (holds and cooldown still apply).
  const handedOver = open.filter((c) => c.noBankAccount && !(reachesQueue(c) && atBand(c)));
  let cards = [...known.filter(atBand), ...handedOver];
  let usedMedium = false;
  if (!cards.length && settings.includeMediumWhenEmpty && settings.queueMinBand !== "medium") {
    cards = known.filter((c) => c.band === "medium");
    usedMedium = cards.length > 0;
  }
  const sorted = [...failed.sort(compareCards(sort)), ...[...cards].sort(compareCards(sort))];
  return { cards: sorted.slice(0, settings.maxCards), total: sorted.length, usedMedium, lowConfidence };
}
