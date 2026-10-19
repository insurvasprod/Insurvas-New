import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { assignOwners, DEFAULT_OWNER_ROLE, LA5_OWNER_ROLES, type AssignItem, type Existing, type La5OwnerRole, type La5Queue, type Member } from "./assignment";
import type { RetentionSettings } from "./constants";

/**
 * LA-5.8 (Notion sprint) · the owners of LA-5 cards, server side. The LA-5 queues are computed when
 * they are read, so their owners are resolved then too, and kept in retention_assignment
 * (20261016200000): one open row per card, closed — never removed — when the owner changes or the
 * card leaves the queue for good. Before the migration the queues work as they did, with no owners.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const PAGE = 1000;
const WRITE_CHUNK = 500;

export type Owner = { userId: string; role: La5OwnerRole; name: string; escalated: boolean };

async function everyRow(build: () => Loose, max = 100_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const keyOf = (r: { carrier_id: string; policy_number: string }) => `${r.carrier_id}|${r.policy_number}`;

/** The agency's members, with their names, for owners and pickers. */
export async function loadMembers(tenantId: string): Promise<Array<Member & { name: string }>> {
  const { data, error } = await db().from("tenant_users").select("user_id, role, accepted_at, invited_at, users!tenant_users_user_id_fkey(id, name, email, status)").eq("tenant_id", tenantId);
  if (error) throw new Error(`Could not read the team: ${error.message}`);
  return ((data ?? []) as Loose[]).map((m) => ({
    userId: m.user_id,
    role: String(m.role),
    // Someone still to accept an invitation owns nothing yet.
    active: m.users?.status === "active" && Boolean(m.accepted_at),
    joinedAt: m.accepted_at ?? m.invited_at ?? null,
    name: m.users?.name || m.users?.email || "Someone",
  }));
}

/** The queue's owner role: the agency's rule (LA-4.9's table), else the spec's default. */
export async function ownerRoleFor(tenantId: string, queue: La5Queue): Promise<La5OwnerRole> {
  const { data, error } = await db().from("queue_assignment_rule").select("owner_role").eq("tenant_id", tenantId).eq("queue_type", queue).maybeSingle();
  if (error && !isSchemaGap(error)) throw new Error(`Could not read the assignment rule: ${error.message}`);
  const role = data?.owner_role as string | undefined;
  return role && (LA5_OWNER_ROLES as readonly string[]).includes(role) ? (role as La5OwnerRole) : DEFAULT_OWNER_ROLE[queue];
}

/**
 * Resolve, persist and return the owner of every card. `keep` = every card still in the queue's
 * universe (held or cooling down included): an open row for any other card is closed, because that
 * card left for good. Without `keep` nothing is closed.
 * Returns null before the migration (no table): the queue then has no owners, as before LA-5.8.
 */
export async function ensureOwners(tenantId: string, queue: La5Queue, items: AssignItem[], settings: RetentionSettings, options: { keep?: Set<string> } = {}): Promise<Map<string, Owner> | null> {
  let open: Loose[];
  try {
    open = await everyRow(() => db().from("retention_assignment").select("id, carrier_id, policy_number, assigned_to_user_id, assigned_role, assigned_at, escalated_at").eq("tenant_id", tenantId).eq("queue_type", queue).is("closed_at", null).order("id"));
  } catch (error) {
    if (isSchemaGap(error as Loose)) return null;
    throw error;
  }
  const [members, ownerRole] = await Promise.all([loadMembers(tenantId), ownerRoleFor(tenantId, queue)]);
  const rowOf = new Map<string, Loose>(open.map((r) => [keyOf(r), r]));
  const existing = new Map<string, Existing>(open.map((r) => [keyOf(r), { userId: r.assigned_to_user_id, role: r.assigned_role, assignedAt: r.assigned_at, escalated: Boolean(r.escalated_at) }]));
  const assigned = assignOwners(items, existing, members, {
    queue, ownerRole, strategy: settings.assignmentStrategy, carrierReps: settings.assignmentCarrierReps, repOrder: settings.assignmentRepOrder, escalateDays: settings.reinstatementEscalateDays,
  });

  const now = new Date().toISOString();
  const itemOf = new Map(items.map((i) => [i.key, i]));
  const toClose: string[] = [];
  const toInsert: Loose[] = [];
  for (const [key, a] of assigned) {
    if (!a.isNew && !a.changed) continue;
    const prior = rowOf.get(key);
    if (prior) toClose.push(prior.id);
    const item = itemOf.get(key)!;
    toInsert.push({
      tenant_id: tenantId, queue_type: queue, carrier_id: item.carrierId, policy_number: key.slice(key.indexOf("|") + 1),
      assigned_to_user_id: a.userId, assigned_role: a.role, strategy: a.role === "retention" ? settings.assignmentStrategy : null,
      exposure_cents: item.exposureCents, assigned_at: now, escalated_at: a.escalated ? now : null,
    });
  }
  if (options.keep) for (const [key, r] of rowOf) if (!options.keep.has(key) && !itemOf.has(key)) toClose.push(r.id);
  for (const part of chunks(toClose, WRITE_CHUNK)) {
    const { error } = await db().from("retention_assignment").update({ closed_at: now }).in("id", part).is("closed_at", null);
    if (error) throw new Error(`Could not move a card's owner: ${error.message}`);
  }
  for (const part of chunks(toInsert, WRITE_CHUNK)) {
    const { error } = await db().from("retention_assignment").insert(part);
    // Two readers resolving at once: the other one's rows stand (one open row per card).
    if (error && error.code !== "23505") throw new Error(`Could not record a card's owner: ${error.message}`);
  }

  const name = new Map(members.map((m) => [m.userId, m.name]));
  return new Map([...assigned].map(([key, a]) => [key, { userId: a.userId, role: a.role, name: name.get(a.userId) ?? "Someone", escalated: a.escalated }]));
}

/** The one card's current owner (for a write by a retention rep), or null. */
export async function ownerOf(tenantId: string, queue: La5Queue, carrierId: string, policyNumber: string): Promise<{ userId: string } | null> {
  const { data, error } = await db().from("retention_assignment").select("assigned_to_user_id").eq("tenant_id", tenantId).eq("queue_type", queue).eq("carrier_id", carrierId).eq("policy_number", policyNumber).is("closed_at", null).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(error.message);
  }
  return data ? { userId: data.assigned_to_user_id } : null;
}

/** Whether a member of this role exists: a solo agent never sees owners at all. */
export const showsOwners = (members: Member[]) => members.filter((m) => m.active).length > 1;
