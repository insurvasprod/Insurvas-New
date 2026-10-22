/**
 * Where a lead the dialer refused goes back to (returnRefusedLead, lib/dialerScripts/service.ts).
 *
 * LA-2.8: a lead the dialer serves and then refuses (the agent is not licensed in its state) goes back exactly
 * as the queue would find it. For a POOL lead that is the pool: unclaimed, nobody's. AG-0.10: in an agency the
 * owner routes the leads, so a lead the owner had ASSIGNED to this producer is not the pool's to take back —
 * returning it there would silently undo the owner's routing. It stays assigned to the producer (claimed, owned
 * by him, unlocked, as an assigned lead sits between calls) and the reason is written to its assignment history,
 * where the owner sees it and can reassign it. A solo tenant keeps the old hand-back unchanged.
 */
export type RefusedLeadHandBack = "keep_assigned" | "return_to_pool";

export function refusedLeadHandBack(input: { agency: boolean; assignedToAgent: boolean }): RefusedLeadHandBack {
  return input.agency && input.assignedToAgent ? "keep_assigned" : "return_to_pool";
}

/** The assignment history event types that make a work item someone's (lead_queue_assignee, 20260924323000). */
export const ASSIGNING_EVENTS = ["assigned", "pulled", "reassigned"] as const;

/** Was the work item assigned to this agent? From its latest assignment event, the rule lead_queue_assignee reads. */
export function assignedTo(latest: { event_type?: unknown; to_user_id?: unknown } | null | undefined, agentId: string): boolean {
  if (!latest) return false;
  return (ASSIGNING_EVENTS as readonly string[]).includes(String(latest.event_type ?? "")) && String(latest.to_user_id ?? "") === agentId;
}

/**
 * The history line for a refused assigned lead. lead_assignment_events.reason is 1–500 characters. Recorded as a
 * `reassigned` event from the producer to himself: lead_queue_assignee reads the LATEST event, and any other
 * event type would make the lead nobody's and drop it out of his queue.
 */
export function keptAssignedReason(message: string | null | undefined): string {
  const said = (message ?? "").trim() || "the licence check could not be read";
  const why = /[.!?]$/.test(said) ? said : `${said}.`;
  const line = `Kept assigned after the dialer passed over it: ${why} The owner can reassign it to a licensed producer.`;
  return line.length > 500 ? `${line.slice(0, 499)}…` : line;
}
