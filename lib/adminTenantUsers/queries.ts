import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getEntitlement } from "@/lib/entitlements/get";
import { EMPTY_ENTITLEMENT, type Entitlement } from "@/lib/entitlements/types";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";
import { getTeamSnapshot, type TeamMember } from "@/lib/tenantTeam/service";
import { seatCounts, seatLimitFor, seatState, type SeatCounts } from "@/lib/tenantTeam/seats";
import { sortMembers } from "./present";
import type { AdminTenantMember, AdminTenantUsers } from "./types";

type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null };
type LooseRpc = { rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<RpcResult<T>> };

/** True when this member's invitation can be withdrawn, and whether it has expired (stale). */
export function inviteStatus(member: Pick<TeamMember, "acceptedAt" | "inviteExpiresAt">, now: number) {
  const revocable = !member.acceptedAt;
  const stale = revocable && Boolean(member.inviteExpiresAt) && new Date(member.inviteExpiresAt as string).getTime() < now;
  return { revocable, stale };
}

/**
 * The plan's seat limit, the way the database enforces it (plan_limits.max_seats for the tenant's
 * current plan), with the entitlement engine's individual-plan fallback of one seat.
 */
async function seatLimit(tenantId: string): Promise<number | null> {
  const supabase = getSupabaseServiceClient();
  const { data: planId } = await supabase.rpc("tenant_current_plan", { p_tenant_id: tenantId });
  const plan = (planId as unknown as string | null) ?? null;
  if (!plan) return null;
  const [{ data: limits }, { data: planRow }] = await Promise.all([
    supabase.from("plan_limits").select("max_seats").eq("plan_id", plan).maybeSingle<{ max_seats: number | null }>(),
    supabase.from("plans").select("plan_type").eq("id", plan).maybeSingle<{ plan_type: string | null }>(),
  ]);
  return seatLimitFor(limits?.max_seats ?? null, planRow?.plan_type ?? null);
}

/** Successful sign-ins per member over 30 days. Null map when migration 20260924346100 is missing. */
async function signIns(tenantId: string): Promise<Map<string, number> | null> {
  const { data, error } = await (getSupabaseServiceClient() as unknown as LooseRpc).rpc<Array<{ user_id: string; sign_ins: number }>>(
    "admin_tenant_member_sign_ins",
    { p_tenant_id: tenantId, p_days: 30 },
  );
  if (error) {
    if (!isPendingSchema(error)) console.error(`[admin tenant users] sign-in counts failed: ${error.message}`);
    return null;
  }
  return new Map((data ?? []).map((row) => [row.user_id, Number(row.sign_ins) || 0]));
}

async function entitlementFor(tenantId: string): Promise<Entitlement> {
  // The snapshot reads only the seat and buffer limits from it, and this tab computes its own limit,
  // so a tenant whose entitlement cannot be computed still gets its people list.
  try {
    return await getEntitlement(tenantId);
  } catch (error) {
    console.error(`[admin tenant users] entitlement unavailable: ${error instanceof Error ? error.message : error}`);
    return { ...EMPTY_ENTITLEMENT, tenant_id: tenantId } as Entitlement;
  }
}

/** Everything the Users & seats tab shows, for one tenant. */
export async function loadTenantUsers(tenantId: string): Promise<AdminTenantUsers> {
  const [entitlement, max, counts] = await Promise.all([entitlementFor(tenantId), seatLimit(tenantId), signIns(tenantId)]);
  const snapshot = await getTeamSnapshot(tenantId, entitlement);
  const now = Date.now();

  const members: AdminTenantMember[] = snapshot.members.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    status: member.status,
    role: member.role,
    invitedAt: member.invitedAt,
    acceptedAt: member.acceptedAt,
    lastSeenAt: member.lastSeenAt ?? null,
    lastLoginAt: member.lastLoginAt ?? null,
    inviteExpiresAt: member.inviteExpiresAt ?? null,
    signIns30d: counts ? counts.get(member.id) ?? 0 : null,
    seat: seatState(member),
    ...inviteStatus(member, now),
  }));

  return {
    members: sortMembers(members),
    seats: { ...seatCounts(snapshot.members), max },
    presenceRecorded: snapshot.presenceRecorded !== false,
    signInsAvailable: counts !== null,
    readAt: now,
  };
}

/**
 * Seats held by one tenant, counted in TypeScript by the one seat rule (lib/tenantTeam/seats.ts) —
 * the same answer `tenant_seats_used` gives (20260924346000). One small read, memoised per request,
 * so the record's frame chip and the Overview's usage panel share it. Throws when it cannot count:
 * "0 seats" must never stand in for "we could not read the members".
 */
export const fetchTenantSeatCounts = cache(async (tenantId: string): Promise<SeatCounts> => {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("accepted_at, users!tenant_users_user_id_fkey(status)")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`Could not count seats: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{ accepted_at: string | null; users: { status: string } | null }>;
  return seatCounts(rows.map((row) => ({ status: row.users?.status, acceptedAt: row.accepted_at })));
});
