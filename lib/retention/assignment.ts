/**
 * LA-5.8 (Notion sprint) · who owns each LA-5 card, as plain rules. LA-4.9's ownership model,
 * extended — not a second one: the queue's owner role comes from queue_assignment_rule, and a role
 * with nobody in it falls back to the agency's owner, so no card is ever without an owner.
 *
 *   Save queue      retention if the role has users, else the writing agent (else the owner).
 *   Paper-bill      retention (else the owner).
 *   Reinstatement   retention (else the owner), moving to the writing agent inside the escalation
 *                   window — inside a week the relationship matters more than the process.
 *
 * Among retention reps: round-robin (the default: the rep with the fewest open cards, then the one
 * assigned to longest ago), by carrier (a carrier → rep map; an unmapped carrier is round-robin), or
 * by exposure (the biggest cases to the first rep in the agency's order, each rep up to a fair share).
 * An owner stays with a card until they leave the role, so a rep's list does not reshuffle daily.
 *
 * Pure; relative imports only.
 */

import type { AssignmentStrategy } from "./constants.ts";

export const LA5_QUEUES = ["save_queue", "paper_bill", "reinstatement"] as const;
export type La5Queue = (typeof LA5_QUEUES)[number];
export const LA5_QUEUE_LABELS: Record<La5Queue, string> = { save_queue: "Save queue", paper_bill: "Paper-bill campaign", reinstatement: "Reinstatement cases" };

export const LA5_OWNER_ROLES = ["retention", "writing_agent", "admin"] as const;
export type La5OwnerRole = (typeof LA5_OWNER_ROLES)[number];
export const LA5_OWNER_ROLE_LABELS: Record<La5OwnerRole, string> = { retention: "Retention reps", writing_agent: "The writing agent", admin: "The owner" };

/** The spec's defaults; a queue_assignment_rule row overrides the owner role. */
export const DEFAULT_OWNER_ROLE: Record<La5Queue, La5OwnerRole> = { save_queue: "retention", paper_bill: "retention", reinstatement: "retention" };

export type Member = { userId: string; role: string; active: boolean; joinedAt?: string | null };

export type AssignItem = {
  key: string;
  carrierId: string;
  /** The writing agent on the policy, if known. */
  writingAgentId: string | null;
  exposureCents: number | null;
  /** Reinstatement only: days until the carrier's window closes (null: no deadline known). */
  daysToDeadline?: number | null;
};

export type Existing = { userId: string; role: La5OwnerRole; assignedAt: string; escalated: boolean };

export type Assignment = { userId: string; role: La5OwnerRole; isNew: boolean; escalated: boolean; changed: boolean };

export type AssignConfig = {
  queue: La5Queue;
  ownerRole: La5OwnerRole;
  strategy: AssignmentStrategy;
  carrierReps: Record<string, string>;
  repOrder: string[];
  escalateDays: number;
};

const byJoined = (a: Member, b: Member) => (a.joinedAt ?? "9999").localeCompare(b.joinedAt ?? "9999") || a.userId.localeCompare(b.userId);

export function poolOf(members: Member[]) {
  const active = members.filter((m) => m.active);
  return {
    reps: active.filter((m) => m.role === "retention").sort(byJoined),
    owners: active.filter((m) => m.role === "owner").sort(byJoined),
    agents: new Set(active.filter((m) => m.role === "owner" || m.role === "producer").map((m) => m.userId)),
    active,
  };
}

/** Still a valid owner for this role? A rep who left the role, or an agent who left, is not. */
function stillValid(e: Existing, pool: ReturnType<typeof poolOf>): boolean {
  if (e.role === "retention") return pool.reps.some((r) => r.userId === e.userId);
  if (e.role === "writing_agent") return pool.agents.has(e.userId);
  return pool.owners.some((o) => o.userId === e.userId);
}

/**
 * Owners for every item. Existing owners are kept while valid; new items are placed by the strategy.
 * Throws only when the agency has no active member at all (it cannot then be viewed either).
 */
export function assignOwners(items: AssignItem[], existing: Map<string, Existing>, members: Member[], config: AssignConfig): Map<string, Assignment> {
  const pool = poolOf(members);
  const admin = pool.owners[0]?.userId ?? pool.active.sort(byJoined)[0]?.userId ?? null;
  const out = new Map<string, Assignment>();
  // Open load per rep, counting the cards they keep.
  const load = new Map<string, number>(pool.reps.map((r) => [r.userId, 0]));
  const lastAt = new Map<string, string>();
  for (const item of items) {
    const e = existing.get(item.key);
    if (e && e.role === "retention" && stillValid(e, pool)) {
      load.set(e.userId, (load.get(e.userId) ?? 0) + 1);
      if ((lastAt.get(e.userId) ?? "") < e.assignedAt) lastAt.set(e.userId, e.assignedAt);
    }
  }

  const writingAgent = (item: AssignItem) => (item.writingAgentId && pool.agents.has(item.writingAgentId) ? item.writingAgentId : null);
  const fallback = (item: AssignItem): { userId: string; role: La5OwnerRole } => {
    // The save queue's own default: the writing agent when nobody works retention.
    if (config.queue === "save_queue" && config.ownerRole === "retention") {
      const agent = writingAgent(item);
      if (agent) return { userId: agent, role: "writing_agent" };
    }
    if (!admin) throw new Error("This agency has no active member to own a retention card.");
    return { userId: admin, role: "admin" };
  };
  const roundRobin = (): string => {
    const sorted = [...pool.reps].sort((a, b) => (load.get(a.userId)! - load.get(b.userId)!) || (lastAt.get(a.userId) ?? "").localeCompare(lastAt.get(b.userId) ?? "") || byJoined(a, b));
    return sorted[0].userId;
  };

  // The kind of owner the rule asks for now. A card keeps its owner only while it is still that kind
  // (a rep joining moves the writing agents' save cards to retention; a rule change moves them too).
  const desired = (item: AssignItem): La5OwnerRole => {
    if (config.ownerRole === "admin") return "admin";
    if (config.ownerRole === "writing_agent") return writingAgent(item) ? "writing_agent" : "admin";
    if (pool.reps.length) return "retention";
    return fallback(item).role;
  };
  const fresh: AssignItem[] = [];
  for (const item of items) {
    const e = existing.get(item.key);
    // An escalated reinstatement case is judged on its base owner; the window step below re-applies.
    if (e && stillValid(e, pool) && !e.escalated && e.role === desired(item)) {
      out.set(item.key, { userId: e.userId, role: e.role, isNew: false, escalated: false, changed: false });
    } else {
      fresh.push(item);
    }
  }

  const ordered = config.strategy === "by_exposure" ? [...fresh].sort((a, b) => (b.exposureCents ?? -1) - (a.exposureCents ?? -1) || a.key.localeCompare(b.key)) : [...fresh].sort((a, b) => a.key.localeCompare(b.key));
  // By exposure: reps in the agency's order (unlisted reps after, by joining), each up to a fair share.
  const ranked = config.strategy === "by_exposure"
    ? [...pool.reps].sort((a, b) => {
        const ia = config.repOrder.indexOf(a.userId);
        const ib = config.repOrder.indexOf(b.userId);
        return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || byJoined(a, b);
      })
    : [];
  const totalOpen = items.length;
  const share = pool.reps.length ? Math.ceil(totalOpen / pool.reps.length) : 0;

  for (const item of ordered) {
    const prior = existing.get(item.key);
    let pick: { userId: string; role: La5OwnerRole };
    if (config.ownerRole === "admin") {
      pick = admin ? { userId: admin, role: "admin" } : fallback(item);
    } else if (config.ownerRole === "writing_agent") {
      const agent = writingAgent(item);
      pick = agent ? { userId: agent, role: "writing_agent" } : fallback({ ...item, writingAgentId: null });
    } else if (!pool.reps.length) {
      pick = fallback(item);
    } else if (config.strategy === "by_carrier" && config.carrierReps[item.carrierId] && pool.reps.some((r) => r.userId === config.carrierReps[item.carrierId])) {
      pick = { userId: config.carrierReps[item.carrierId], role: "retention" };
    } else if (config.strategy === "by_exposure") {
      const rep = ranked.find((r) => (load.get(r.userId) ?? 0) < share) ?? ranked[0];
      pick = { userId: rep.userId, role: "retention" };
    } else {
      pick = { userId: roundRobin(), role: "retention" };
    }
    if (pick.role === "retention") {
      load.set(pick.userId, (load.get(pick.userId) ?? 0) + 1);
      lastAt.set(pick.userId, "~");
    }
    out.set(item.key, { ...pick, isNew: !prior, escalated: false, changed: false });
  }

  // Reinstatement: inside the escalation window the case goes to the person who sold it.
  if (config.queue === "reinstatement") {
    for (const item of items) {
      const a = out.get(item.key)!;
      const agent = writingAgent(item);
      if (item.daysToDeadline === null || item.daysToDeadline === undefined || item.daysToDeadline > config.escalateDays || !agent) continue;
      out.set(item.key, { userId: agent, role: "writing_agent", isNew: a.isNew, escalated: true, changed: false });
    }
  }
  // Changed: an existing row whose owner, role or escalation is not what it was.
  for (const [key, a] of out) {
    const prior = existing.get(key);
    a.changed = Boolean(prior) && (prior!.userId !== a.userId || prior!.role !== a.role || prior!.escalated !== a.escalated);
  }
  return out;
}

/** Whether a viewer works this card: a retention rep only their own; everyone else as before. */
export const ownsCard = (viewer: { userId: string; role: string }, owner: { userId: string } | undefined) =>
  viewer.role !== "retention" || owner?.userId === viewer.userId;
