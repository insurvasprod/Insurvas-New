import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Entitlement } from "@/lib/entitlements/types";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import { isPendingSchema, SchemaPendingError } from "@/lib/appointments/pendingSchema";
import { newestStamp } from "./lastSeen";
import { heldSeat } from "./seats";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  status: string;
  role: TenantRole;
  invitedAt: string;
  acceptedAt: string | null;
  /** users.last_login_at — the last successful sign-in, not presence. */
  lastLoginAt?: string | null;
  /**
   * Presence: the newest of the member's activity stamp (migration 20260924220400), the Agent Floor
   * heartbeat and their last sign-in. Null when no presence is recorded; the screen then says
   * "Signed in …" from lastLoginAt instead.
   */
  lastSeenAt?: string | null;
  /** The newest unaccepted invitation's expiry, for someone who has not accepted yet. */
  inviteExpiresAt?: string | null;
  /** States this person is personally licensed in (migration 20260924110000). Empty = not recorded. */
  licensedStates?: string[];
  /** The day each of those licences lapses, by state (migration 20260925702000). Absent = none recorded. */
  licensedStateExpiries?: Record<string, string>;
};

export type TeamSnapshot = {
  members: TeamMember[];
  seats: { used: number; max: number | null; byRole: Record<TenantRole, number> };
  bufferSeats: { used: number; max: number | null };
  outboundLimits?: Array<{ key: string; label: string; usage: number; limit: number | null; hardCap: boolean; allowed: boolean }>;
  /** False until migration 20260924110000 is applied, so the screen can say why states cannot be saved. */
  licensedStatesAvailable?: boolean;
  /** False until migration 20260924220400 is applied: "Last seen" falls back to the last sign-in. */
  presenceRecorded?: boolean;
  /** The signed-in person, set by the settings page (not by GET /api/app/team). */
  viewerId?: string;
};

export async function getTeamSnapshot(tenantId: string, entitlement: Entitlement): Promise<TeamSnapshot> {
  const supabase = getSupabaseServiceClient();
  // One trip for the members: the user row is embedded through tenant_users_user_id_fkey (the only
  // foreign key from tenant_users to users, checked live 2026-09-23). The licensed states go out
  // alongside it; the pending invitations need the member list, so they follow.
  const [membershipResult, statesResult, activityResult, floorResult] = await Promise.all([
    supabase
      .from("tenant_users")
      .select("user_id, role, invited_at, accepted_at, users!tenant_users_user_id_fkey(id, name, email, status, last_login_at)")
      .eq("tenant_id", tenantId)
      .order("invited_at", { ascending: true }),
    licensedStatesWithExpiry(tenantId),
    // Presence: the stamp the alert-feed poll writes (lib/tenantTeam/presence.ts), and the Agent
    // Floor heartbeat. Both are garnish; a failed read falls back to the last sign-in.
    supabase.from("tenant_member_activity" as never).select("user_id, last_seen_at").eq("tenant_id", tenantId),
    supabase.from("agent_presence").select("user_id, last_seen_at").eq("tenant_id", tenantId),
  ]);

  const { data: rows, error: membershipError } = membershipResult;
  if (membershipError) throw new Error(`Could not load team: ${membershipError.message}`);

  // Pending invitations, keyed by the people who have not accepted (an invited account belongs to
  // the one tenant that invited it; partner invitations carry partner_id and are excluded).
  const pendingIds = ((rows ?? []) as Array<{ user_id: string; accepted_at: string | null }>).filter((row) => !row.accepted_at).map((row) => row.user_id);
  const invitationResult = pendingIds.length
    ? await supabase
        .from("user_invitations")
        .select("user_id, expires_at, created_at")
        .in("user_id", pendingIds)
        .is("partner_id", null)
        .eq("purpose", "invite")
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Invitation expiry and licensed states are garnish on the table: a failed read leaves them blank
  // rather than taking the team down.
  const inviteExpiry = new Map<string, string>();
  for (const row of (invitationResult.data ?? []) as Array<{ user_id: string; expires_at: string }>) {
    if (!inviteExpiry.has(row.user_id)) inviteExpiry.set(row.user_id, row.expires_at);
  }
  const statesError = statesResult.error as { message: string; code?: string } | null;
  const licensedStatesAvailable = !isPendingSchema(statesError);
  const statesByUser = new Map<string, string[]>();
  const expiriesByUser = new Map<string, Record<string, string>>();
  for (const row of (statesError ? [] : ((statesResult.data ?? []) as unknown as Array<{ user_id: string; state: string; expires_on?: string | null }>))) {
    statesByUser.set(row.user_id, [...(statesByUser.get(row.user_id) ?? []), row.state].sort());
    if (row.expires_on) expiriesByUser.set(row.user_id, { ...(expiriesByUser.get(row.user_id) ?? {}), [row.state]: row.expires_on.slice(0, 10) });
  }

  const activityError = activityResult.error as { message: string; code?: string } | null;
  const presenceRecorded = !activityError;
  if (activityError && !isPendingSchema(activityError)) console.error(`[team] could not read member activity: ${activityError.message}`);
  const activityByUser = new Map(((activityError ? [] : activityResult.data ?? []) as unknown as Array<{ user_id: string; last_seen_at: string }>).map((row) => [row.user_id, row.last_seen_at]));
  const floorByUser = new Map(((floorResult.error ? [] : floorResult.data ?? []) as Array<{ user_id: string; last_seen_at: string }>).map((row) => [row.user_id, row.last_seen_at]));

  type MemberUser = { id: string; name: string; email: string; status: string; last_login_at: string | null };
  const memberships = (rows ?? []) as unknown as Array<{ user_id: string; role: string; invited_at: string; accepted_at: string | null; users: MemberUser | null }>;
  const byRole: Record<TenantRole, number> = { owner: 0, producer: 0, assistant: 0, bookkeeper: 0, setter: 0 };
  const members: TeamMember[] = memberships.flatMap((membership) => {
    const user = membership.users;
    if (!user) return [];
    const role = membership.role as TenantRole;
    // Seats by role, by the one seat rule (lib/tenantTeam/seats.ts): deactivated and deleted people hold none.
    if (heldSeat({ status: user.status, acceptedAt: membership.accepted_at })) byRole[role] += 1;
    return [{
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role,
      invitedAt: membership.invited_at,
      acceptedAt: membership.accepted_at,
      lastLoginAt: user.last_login_at ?? null,
      lastSeenAt: presenceRecorded
        ? newestStamp(activityByUser.get(user.id), floorByUser.get(user.id), user.last_login_at)
        : floorAfterSignIn(floorByUser.get(user.id), user.last_login_at),
      inviteExpiresAt: membership.accepted_at ? null : inviteExpiry.get(user.id) ?? null,
      licensedStates: statesByUser.get(user.id) ?? [],
      licensedStateExpiries: expiriesByUser.get(user.id) ?? {},
    }];
  });

  const activeBufferSeats = members.filter((member) => member.role === "assistant" && heldSeat(member)).length;
  return {
    members,
    seats: { used: members.filter((member) => heldSeat(member)).length, max: entitlement.limits.max_seats, byRole },
    bufferSeats: { used: activeBufferSeats, max: entitlement.limits.max_buffer_seats },
    licensedStatesAvailable,
    presenceRecorded,
  };
}

/** Before the activity stamp exists, the floor heartbeat counts as presence only when it is newer than the sign-in. */
function floorAfterSignIn(floor: string | undefined, signIn: string | null) {
  if (!floor) return null;
  if (!signIn) return floor;
  return new Date(floor).getTime() > new Date(signIn).getTime() ? floor : null;
}

/** The licensed-state rows with their expiry; before 20260925702000, without it. */
async function licensedStatesWithExpiry(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const full = await supabase.from("tenant_user_licensed_states" as never).select("user_id, state, expires_on").eq("tenant_id", tenantId);
  const error = full.error as { message: string; code?: string } | null;
  if (!error || !/expires_on/.test(error.message ?? "") || !isPendingSchema(error)) return full;
  return supabase.from("tenant_user_licensed_states" as never).select("user_id, state").eq("tenant_id", tenantId);
}

/**
 * Replaces one member's licensed states, and, when `expiries` is given, the day each lapses.
 * Enforced by assignment_candidate_is_eligible and agent_may_work_state. Without `expiries` the
 * states-only save keeps every expiry already recorded for a state that stays (20260925702000).
 */
export async function setMemberLicensedStates(
  tenantId: string,
  userId: string,
  states: string[],
  expiries?: Record<string, string | null>,
): Promise<{ states: string[]; expiries: Record<string, string> }> {
  const client = getSupabaseServiceClient();
  if (expiries !== undefined) {
    const rows = states.map((state) => ({ state, expires_on: expiries[state] ?? null }));
    const { data, error } = await client.rpc("set_tenant_user_licensed_states_with_expiry" as never, { p_tenant_id: tenantId, p_user_id: userId, p_rows: rows } as never);
    if (!error) {
      const saved = (data ?? []) as unknown as Array<{ state: string; expires_on: string | null }>;
      return {
        states: saved.map((row) => row.state).filter(Boolean),
        expiries: Object.fromEntries(saved.filter((row) => row.expires_on).map((row) => [row.state, String(row.expires_on).slice(0, 10)])),
      };
    }
    if (error.message?.includes("member_not_found")) throw new Error("member_not_found");
    // Before the migration, a save with no dates is the old save; one with dates cannot be kept.
    if (!isPendingSchema(error) || rows.some((row) => row.expires_on)) {
      if (isPendingSchema(error)) throw new SchemaPendingError();
      throw new Error(error.message);
    }
  }
  const { data, error } = await client.rpc("set_tenant_user_licensed_states" as never, { p_tenant_id: tenantId, p_user_id: userId, p_states: states } as never);
  if (error) {
    if (isPendingSchema(error)) throw new SchemaPendingError();
    if (error.message?.includes("member_not_found")) throw new Error("member_not_found");
    throw new Error(error.message);
  }
  const result = (data ?? []) as unknown as Array<string | { set_tenant_user_licensed_states?: string; state?: string }>;
  return { states: result.map((row) => (typeof row === "string" ? row : row.set_tenant_user_licensed_states ?? row.state ?? "")).filter(Boolean), expiries: {} };
}

type PendingMember = { user_id: string; name: string; email: string };

/** The member, if they are in this tenant and have not accepted. Throws not_found / not_pending. */
async function pendingMember(tenantId: string, userId: string): Promise<PendingMember> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("user_id, accepted_at, users!tenant_users_user_id_fkey(id, name, email)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as unknown as { user_id: string; accepted_at: string | null; users: { name: string; email: string } | null } | null;
  if (!row || !row.users) throw new Error("not_found");
  if (row.accepted_at) throw new Error("not_pending");
  return { user_id: row.user_id, name: row.users.name, email: row.users.email };
}

/**
 * Issues a fresh invitation link and retires the old one. The new row is written first, so a failure
 * part-way leaves the person with a working link rather than none.
 */
export async function resendTenantInvite(params: { tenantId: string; userId: string; tokenHash: string; expiresAt: string }): Promise<PendingMember> {
  const member = await pendingMember(params.tenantId, params.userId);
  const supabase = getSupabaseServiceClient();
  const { data: created, error } = await supabase
    .from("user_invitations")
    .insert({ user_id: params.userId, tenant_id: params.tenantId, token_hash: params.tokenHash, expires_at: params.expiresAt, purpose: "invite" } as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !created) throw new Error(error?.message ?? "Could not issue a new invitation");
  const { error: retireError } = await supabase
    .from("user_invitations")
    .update({ expires_at: new Date().toISOString() } as never)
    .eq("user_id", params.userId)
    // This tenant's invitations only: the same person can hold a pending invite from another agency.
    .eq("tenant_id" as never, params.tenantId as never)
    .is("partner_id", null)
    .eq("purpose", "invite")
    .is("accepted_at", null)
    .neq("id", created.id);
  if (retireError) console.error("[team] could not retire the previous invitation", retireError.message);
  return member;
}

/**
 * Withdraws an unaccepted invitation and frees the seat it held (seats are tenant_users rows).
 *
 * The account the invite created is removed too when it belongs to nobody else, so the same address
 * can be invited again; if that removal fails the seat is still freed and the caller is told.
 */
export async function revokeTenantInvite(tenantId: string, userId: string): Promise<{ email: string; accountRemoved: boolean }> {
  const member = await pendingMember(tenantId, userId);
  const supabase = getSupabaseServiceClient();
  // This tenant's invitations only. Without the tenant filter, revoking an invite here also deleted
  // any pending invitation the same person held from another agency.
  const { error: invitationError } = await supabase.from("user_invitations").delete().eq("user_id", userId).eq("tenant_id" as never, tenantId as never).is("partner_id", null).eq("purpose", "invite").is("accepted_at", null);
  if (invitationError) throw new Error(invitationError.message);
  const { error: membershipError } = await supabase.from("tenant_users").delete().eq("tenant_id", tenantId).eq("user_id", userId).is("accepted_at", null);
  if (membershipError) throw new Error(membershipError.message);

  const [{ count: otherMemberships }, profile] = await Promise.all([
    supabase.from("tenant_users").select("user_id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("users").select("status").eq("id", userId).maybeSingle<{ status: string }>(),
  ]);
  let accountRemoved = false;
  if ((otherMemberships ?? 0) === 0) {
    // Invitations from before user_invitations had a tenant_id (20260910120000) carry none. Once the
    // person belongs to no tenant at all, such a row can only have been an invitation to this one.
    const { error: legacyError } = await supabase.from("user_invitations").delete().eq("user_id", userId).is("tenant_id" as never, null).is("partner_id", null).eq("purpose", "invite").is("accepted_at", null);
    if (legacyError) console.error("[team] could not remove a pre-tenant invitation row", legacyError.message);
  }
  if ((otherMemberships ?? 0) === 0 && profile.data?.status === "invited") {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    accountRemoved = !error;
    if (error) console.error("[team] revoked invite but could not remove the unused account", error.message);
  }
  return { email: member.email, accountRemoved };
}
