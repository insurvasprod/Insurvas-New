/**
 * "An agent without an active licence in the lead's state is … refused by the dialer."
 *
 * The rule the dialer applies before it serves or dials a lead — the same one migration
 * 20260924220200 writes as agent_may_work_state for the queue, and the licence half of the one lead
 * assignment applies (assignment_candidate_is_eligible):
 *
 *   · a setter books only and never sells, so a setter may dial any lead;
 *   · an owner or producer needs the agency to hold an unexpired licence in the lead's state and,
 *     when their own licensed states are recorded on Team & access, the state must be one of theirs;
 *   · a lead with no state cannot be judged.
 *
 * `agentStates` is null when the per-agent table does not exist yet (migration 20260924110000 not
 * applied): the agent is then judged on the agency's licences alone, and the refusal says so.
 *
 * Pure, so the rule is testable without a database.
 */

export type LicenceDecision =
  | { allowed: true; basis: "setter" | "agent" | "agency" }
  | { allowed: false; reason: "no_state" | "agency_unlicensed" | "agency_expired" | "agent_unlicensed" | "role"; message: string };

export type LicenceInput = {
  role: string | null;
  state: string | null;
  /** The agency's licences: state and expiry (YYYY-MM-DD, or null for no expiry). */
  agencyLicences: Array<{ state: string; expires_at: string | null }>;
  /** The agent's own licensed states; [] = none recorded; null = cannot be recorded yet. */
  agentStates: string[] | null;
  /** YYYY-MM-DD. */
  today: string;
};

export function decideDialLicence(input: LicenceInput): LicenceDecision {
  if (input.role === "setter") return { allowed: true, basis: "setter" };
  if (input.role !== "owner" && input.role !== "producer") {
    return { allowed: false, reason: "role", message: "Only owners, producers and setters work the dialer." };
  }
  const state = (input.state ?? "").trim().toUpperCase();
  if (!state) {
    return { allowed: false, reason: "no_state", message: "Dialing is refused because this lead has no state, so there is no way to tell whether you are licensed to sell to it." };
  }
  const held = input.agencyLicences.filter((licence) => licence.state.trim().toUpperCase() === state);
  const current = held.some((licence) => !licence.expires_at || licence.expires_at.slice(0, 10) >= input.today);
  const fallbackNote = input.agentStates === null ? " (Your own licensed states cannot be recorded until a database update is applied, so the agency's licences are what is checked.)" : "";
  if (!current) {
    return held.length
      ? { allowed: false, reason: "agency_expired", message: `Dialing is refused: the agency's ${state} licence has expired. Renew it on Settings › States & licences before calling ${state} leads.${fallbackNote}` }
      : { allowed: false, reason: "agency_unlicensed", message: `Dialing is refused: the agency holds no ${state} licence. Add it on Settings › States & licences before calling ${state} leads.${fallbackNote}` };
  }
  if (input.agentStates === null) return { allowed: true, basis: "agency" };
  const own = input.agentStates.map((code) => code.trim().toUpperCase());
  if (own.length === 0) return { allowed: true, basis: "agency" };
  if (own.includes(state)) return { allowed: true, basis: "agent" };
  return { allowed: false, reason: "agent_unlicensed", message: `Dialing is refused: you are not licensed in ${state}. An owner can add ${state} to your licensed states on Settings › Team & access, or the lead can go to someone who is.` };
}

/**
 * What a serve had set before it claimed a lead, from the tier it was served in — so a lead the
 * dialer refuses can be put back exactly as the queue would find it. Tiers 4–6 are chosen by
 * lead_state; 1–3 by a recent post, a due callback or a due appointment, which do not depend on it.
 */
export function leadStateBeforeServe(tier: number): "retry" | "fresh" | "nurture" | null {
  if (tier === 4) return "retry";
  if (tier === 5) return "fresh";
  if (tier === 6) return "nurture";
  return null;
}
