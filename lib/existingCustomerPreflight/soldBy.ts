// Shared by the lead page (client) and the pre-flight service: plain logic, no server-only.

/**
 * A match's outcome is a disposition key (`application_submitted`, from deal_flow.call_result or the
 * queue), not a bare word, so the sold word is matched at the end of the key as well as on its own.
 */
export const OUTCOME_SOLD = /(^|_)(sold|issued|approved|won|converted|submitted)$/i;

type MatchLike = { sourceType: "lead" | "contact"; outcome: string | null; partnerId: string | null; partnerName: string | null };

export function isSoldMatch(match: MatchLike) {
  return match.sourceType === "lead" && Boolean(match.outcome && OUTCOME_SOLD.test(match.outcome.trim()));
}

/**
 * LA-1.24-5: the partners who have already sold this person, one entry per partner. Two or more is
 * its own flag: the same customer sold twice by two different partners is a commission dispute
 * waiting to happen, which is a different problem from "already a customer".
 */
export function soldByPartners(matches: MatchLike[]): Array<{ partnerId: string; partnerName: string }> {
  const byPartner = new Map<string, string>();
  for (const match of matches) {
    if (!isSoldMatch(match) || !match.partnerId) continue;
    if (!byPartner.has(match.partnerId)) byPartner.set(match.partnerId, match.partnerName?.trim() || "A partner");
  }
  return [...byPartner.entries()].map(([partnerId, partnerName]) => ({ partnerId, partnerName }));
}

export function soldByMultiplePartners(matches: MatchLike[]) {
  return soldByPartners(matches).length >= 2;
}
