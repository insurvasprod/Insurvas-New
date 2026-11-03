/**
 * LA-8.6 · what is still waiting on a person when they leave. Plain module: the team screen draws it.
 *
 * Every kind is handed to the named teammate on deactivation (20261015640000). A servicing request
 * keeps who asked for it (LA-5.4 fixes that for good); the taker becomes who follows it up
 * (servicing_request.assigned_to), and a failed fix alerts them.
 */
export const OPEN_WORK_KINDS = ["queue_items", "reinstatement_cases", "callbacks", "claimed_leads", "appointments", "servicing_requests"] as const;
export type OpenWorkKind = (typeof OPEN_WORK_KINDS)[number];
export type OpenWork = Record<OpenWorkKind, number>;

export const OPEN_WORK_LABEL: Record<OpenWorkKind, [one: string, many: string]> = {
  queue_items: ["open exception-queue item", "open exception-queue items"],
  reinstatement_cases: ["open reinstatement case", "open reinstatement cases"],
  callbacks: ["scheduled callback", "scheduled callbacks"],
  claimed_leads: ["claimed lead", "claimed leads"],
  appointments: ["upcoming appointment", "upcoming appointments"],
  servicing_requests: ["pending servicing request", "pending servicing requests"],
};

/** Handed over on deactivation — all of it. */
export const REASSIGNED_KINDS: readonly OpenWorkKind[] = OPEN_WORK_KINDS;

/**
 * Who can take a kind of work over: the roles whose screens work it (the database checks the same,
 * tenant_deactivate_member). Exception-queue items go by each item's own role, which the screen
 * does not see, so it offers every role that can hold one and the database decides per item.
 */
export const TAKER_ROLES: Record<OpenWorkKind, readonly string[]> = {
  queue_items: ["owner", "producer", "bookkeeper"],
  reinstatement_cases: ["owner", "producer"],
  callbacks: ["owner", "producer"],
  claimed_leads: ["owner", "producer"],
  appointments: ["owner", "producer"],
  servicing_requests: ["owner", "producer"],
};

/** Can a member in this role take all of this work? */
export function canTakeOver(role: string, work: OpenWork): boolean {
  return OPEN_WORK_KINDS.every((kind) => !(work[kind] > 0) || TAKER_ROLES[kind].includes(role));
}

export function reassignableCount(work: OpenWork): number {
  return REASSIGNED_KINDS.reduce((sum, kind) => sum + (work[kind] ?? 0), 0);
}

/** "14 open exception-queue items and 3 pending servicing requests". Empty when nothing is open. */
export function describeOpenWork(work: OpenWork): string {
  const parts = OPEN_WORK_KINDS.filter((kind) => work[kind] > 0).map((kind) => `${work[kind]} ${OPEN_WORK_LABEL[kind][work[kind] === 1 ? 0 : 1]}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
