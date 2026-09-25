/**
 * What a match is allowed to do on its own. Plain module (no server-only) so the page, the tests and
 * the service read the same rule.
 *
 * A score alone never merges two people. Matching scores a spouse — same address, same phone,
 * similar surname — as highly as a true duplicate; what tells them apart is the date of birth. So:
 *
 *  - AUTO-MERGE only when the match is high confidence, BOTH dates of birth are present and equal,
 *    AND the phone or the address also matches. Nothing else merges without a person.
 *  - A DOB CONFLICT (both present, different) can never auto-merge, whatever the score. It is capped
 *    at review.
 *  - Everything else at medium or high confidence is QUEUED for review.
 *  - LOW matches (score 0.45–0.60) are ignored, as before.
 *
 * link_leads_to_contacts (migration 20260924326100) applies the same auto-merge test in SQL to
 * decide whether a new lead is confidently the same person as an existing contact. Change both or
 * neither; matchPolicy.test.mjs pins them together.
 */

export type MatchConfidence = "high" | "medium" | "low";

export type MatchEvidence = {
  score: number;
  confidence: MatchConfidence;
  matched_on: string[];
  dob: string | null;
};

const day = (value: string | null | undefined) => (typeof value === "string" && value ? value.slice(0, 10) : null);

/** Both dates of birth are known and they are not the same day. */
export function dobConflict(incomingDob: string | null | undefined, match: Pick<MatchEvidence, "dob">): boolean {
  const a = day(incomingDob);
  const b = day(match.dob);
  return a !== null && b !== null && a !== b;
}

/** The only kind of match that may act without a person: see the file comment. */
export function isConfidentMatch(incomingDob: string | null | undefined, match: MatchEvidence): boolean {
  const a = day(incomingDob);
  const b = day(match.dob);
  if (match.confidence !== "high" || a === null || b === null || a !== b) return false;
  return match.matched_on.includes("phone") || match.matched_on.includes("address");
}

/**
 * Splits a scored candidate list (best first, as find_contact_duplicates returns it) into what to do.
 * `queue` is every medium-or-high candidate, including the one being auto-merged: that one is written
 * as a review and resolved by the merge in the same transaction, so undoing the merge reopens it.
 * Only the best candidate may auto-merge. When it does not qualify, nothing merges.
 */
export function planForMatches<T extends MatchEvidence>(incomingDob: string | null | undefined, matches: readonly T[]): { auto: T | null; queue: T[] } {
  const queue = matches.filter((match) => match.confidence === "high" || match.confidence === "medium");
  const top = queue[0] ?? null;
  return { auto: top && isConfidentMatch(incomingDob, top) ? top : null, queue };
}

/** "phone, date of birth, address" — the evidence line on a pair card. */
export function matchedOnLabel(matchedOn: readonly string[]): string {
  const names: Record<string, string> = { phone: "phone", dob: "date of birth", address: "address", name: "name" };
  const parts = matchedOn.map((key) => names[key] ?? key);
  return parts.length ? parts.join(", ") : "overall similarity";
}
