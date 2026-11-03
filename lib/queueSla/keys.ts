/**
 * The dedupe keys of the unclaimed-SLA ladder's side effects, one set per wait in the queue.
 *
 * A transfer that goes back in the queue (returned, or reopened after expiry) starts a new wait and
 * the ladder runs again (20261016400000). Its alerts, emails and partner notice must not be swallowed
 * as duplicates of the first wait's, so from the second wait on the key carries the wait's number.
 * The first wait keeps the original key, so nothing already sent repeats. The database side builds
 * the same strings in run_unclaimed_sla_side_effects.
 */
export function slaKeyBase(workItemId: string, cycle?: number | null) {
  return `unclaimed-sla:${workItemId}${cycle && cycle > 0 ? `~${cycle}` : ""}`;
}

export function slaKey(workItemId: string, cycle: number | null | undefined, what: "escalated" | "offered" | "partner" | "nobody-claimed") {
  return `${slaKeyBase(workItemId, cycle)}:${what}`;
}

/** The partner rung's event key, turned into the agency's "nobody claimed" alert key for the same wait. */
export function nobodyClaimedKeyFromPartnerEvent(eventKey: string) {
  const match = /^(unclaimed-sla:[0-9a-f-]+(?:~\d+)?):partner$/i.exec(eventKey);
  return match ? `${match[1]}:nobody-claimed` : null;
}
