import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Entitlement } from "@/lib/entitlements/types";
import type { TenantRole } from "@/lib/tenantAuth/roles";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  status: string;
  role: TenantRole;
  invitedAt: string;
  acceptedAt: string | null;
};

export type TeamSnapshot = {
  members: TeamMember[];
  seats: { used: number; max: number | null; byRole: Record<TenantRole, number> };
  bufferSeats: { used: number; max: number | null };
};

export async function getTeamSnapshot(tenantId: string, entitlement: Entitlement): Promise<TeamSnapshot> {
  const supabase = getSupabaseServiceClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_users")
    .select("user_id, role, invited_at, accepted_at")
    .eq("tenant_id", tenantId)
    .order("invited_at", { ascending: true });

  if (membershipError) throw new Error(`Could not load team: ${membershipError.message}`);

  const userIds = (memberships ?? []).map((membership) => membership.user_id);
  const { data: users, error: usersError } = userIds.length
    ? await supabase.from("users").select("id, name, email, status").in("id", userIds)
    : { data: [], error: null };
  if (usersError) throw new Error(`Could not load team members: ${usersError.message}`);

  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const byRole: Record<TenantRole, number> = { owner: 0, producer: 0, assistant: 0, bookkeeper: 0 };
  const members = (memberships ?? []).flatMap((membership) => {
    const user = userById.get(membership.user_id);
    if (!user) return [];
    const role = membership.role as TenantRole;
    byRole[role] += 1;
    return [{ id: user.id, name: user.name, email: user.email, status: user.status, role, invitedAt: membership.invited_at, acceptedAt: membership.accepted_at }];
  });

  const activeBufferSeats = members.filter((member) => member.role === "assistant" && (member.status === "active" || member.status === "suspended")).length;
  return { members, seats: { used: members.length, max: entitlement.limits.max_seats, byRole }, bufferSeats: { used: activeBufferSeats, max: entitlement.limits.max_buffer_seats } };
}
