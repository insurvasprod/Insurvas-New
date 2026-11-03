import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";
import { type ProducerStatus } from "./constants";
import { scopeFor, type ProducerScope } from "./visibility";

/**
 * AG-0.7 / AG-1.1 · the producer roster and one producer's record, read through the AG-0.4 scope so a manager
 * sees his reports and a producer sees only himself. Writes go through the SQL functions of 20261018150000;
 * nothing here updates status or can_submit directly (neither has a grant).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export class ProducerRefusal extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "ProducerRefusal";
  }
}

export type RosterRow = {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  status: ProducerStatus;
  role: string | null;
  hiredOn: string | null;
  offboardedOn: string | null;
  canSubmit: boolean;
  canSubmitReason: string | null;
  managerProducerId: string | null;
  inviteExpiresAt: string | null;
  frozenBalanceCents: number | null;
};

export type Roster = { schemaPending: boolean; rows: RosterRow[]; scope: ProducerScope };

const REFUSALS: Record<string, [string, number]> = {
  producer_not_suspendable: ["Only an active or onboarding producer can be suspended.", 409],
  producer_not_found: ["That producer could not be found.", 404],
  already_offboarded: ["This producer is already offboarded.", 409],
  owner_not_offboardable: ["The owner who holds the agency's contracts cannot be offboarded.", 409],
  reactivation_window_closed: ["More than 30 days have passed since offboarding. Invite this person again.", 409],
  producer_not_reactivatable: ["Only a suspended or offboarded producer can be reactivated.", 409],
};

function refusal(error: { code?: string; message?: string }): Error {
  const message = error.message ?? "";
  for (const [code, [text, status]] of Object.entries(REFUSALS)) if (message.includes(code)) return new ProducerRefusal(text, code, status);
  if (isPendingSchema(error as { code?: string; message: string })) return new ProducerRefusal("This needs the agency database update (20261018150000).", "schema_pending", 503);
  return new Error(message);
}

export async function readRoster(context: { tenantId: string; userId: string }): Promise<Roster> {
  const scope = await scopeFor(context);
  let query = db()
    .from("producer")
    .select("id, user_id, display_name, status, hired_on, offboarded_on, can_submit, can_submit_reason, frozen_balance_cents, users!producer_user_id_fkey(email)")
    .eq("tenant_id", context.tenantId)
    .order("display_name");
  if (scope !== null) query = query.in("user_id", scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) {
    if (isPendingSchema(error)) return { schemaPending: true, rows: [], scope };
    throw new Error(`readRoster: ${error.message}`);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const userIds = rows.map((r) => r.user_id as string);
  const [roles, hierarchy, invites] = await Promise.all([
    userIds.length ? db().from("tenant_users").select("user_id, role, agency_role").eq("tenant_id", context.tenantId).in("user_id", userIds) : { data: [] },
    db().from("producer_hierarchy").select("producer_id, parent_producer_id, effective_from, effective_to").eq("tenant_id", context.tenantId),
    userIds.length ? db().from("user_invitations").select("user_id, expires_at").eq("tenant_id", context.tenantId).eq("purpose", "invite").is("accepted_at", null).in("user_id", userIds) : { data: [] },
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const roleOf = new Map(((roles.data ?? []) as Array<{ user_id: string; role: string; agency_role?: string | null }>).map((r) => [r.user_id, r.agency_role ?? r.role]));
  const managerOf = new Map<string, string | null>();
  for (const h of (hierarchy.data ?? []) as Array<{ producer_id: string; parent_producer_id: string | null; effective_from: string; effective_to: string | null }>) {
    if (h.effective_from <= today && (!h.effective_to || today <= h.effective_to)) managerOf.set(h.producer_id, h.parent_producer_id);
  }
  const inviteOf = new Map(((invites.data ?? []) as Array<{ user_id: string; expires_at: string }>).map((r) => [r.user_id, r.expires_at]));
  return {
    schemaPending: false,
    scope,
    rows: rows.map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      displayName: r.display_name as string,
      email: ((r.users as { email?: string } | null)?.email) ?? null,
      status: r.status as ProducerStatus,
      role: roleOf.get(r.user_id as string) ?? null,
      hiredOn: (r.hired_on as string | null) ?? null,
      offboardedOn: (r.offboarded_on as string | null) ?? null,
      canSubmit: Boolean(r.can_submit),
      canSubmitReason: (r.can_submit_reason as string | null) ?? null,
      managerProducerId: managerOf.get(r.id as string) ?? null,
      inviteExpiresAt: inviteOf.get(r.user_id as string) ?? null,
      frozenBalanceCents: r.frozen_balance_cents == null ? null : Number(r.frozen_balance_cents),
    })),
  };
}

export type OffboardPreview = {
  producerId: string;
  displayName: string;
  status: string;
  balanceCents: number;
  policiesInWindow: number;
  advanceAtRiskCents: number;
  seatReleasedOn: string;
  reactivatableUntil: string;
};

export async function offboardPreview(tenantId: string, producerId: string): Promise<OffboardPreview> {
  const { data, error } = await db().rpc("agency_offboard_preview", { p_tenant_id: tenantId, p_producer_id: producerId });
  if (error) throw refusal(error);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.producer_id) throw new ProducerRefusal("That producer could not be found.", "producer_not_found", 404);
  return {
    producerId: row.producer_id as string,
    displayName: row.display_name as string,
    status: row.status as string,
    balanceCents: Number(row.balance_cents ?? 0),
    policiesInWindow: Number(row.policies_in_window ?? 0),
    advanceAtRiskCents: Number(row.advance_at_risk_cents ?? 0),
    seatReleasedOn: row.seat_released_on as string,
    reactivatableUntil: row.reactivatable_until as string,
  };
}

export async function suspendProducer(tenantId: string, producerId: string) {
  const { error } = await db().rpc("agency_suspend_producer", { p_tenant_id: tenantId, p_producer_id: producerId });
  if (error) throw refusal(error);
}

export async function offboardProducer(tenantId: string, producerId: string) {
  const { data, error } = await db().rpc("agency_offboard_producer", { p_tenant_id: tenantId, p_producer_id: producerId });
  if (error) throw refusal(error);
  const row = (Array.isArray(data) ? data[0] : data) as { balance_cents: number; seat_released_on: string; reactivatable_until: string };
  return { balanceCents: Number(row.balance_cents), seatReleasedOn: row.seat_released_on, reactivatableUntil: row.reactivatable_until };
}

export async function reactivateProducer(tenantId: string, producerId: string) {
  const { error } = await db().rpc("agency_reactivate_producer", { p_tenant_id: tenantId, p_producer_id: producerId });
  if (error) throw refusal(error);
}
