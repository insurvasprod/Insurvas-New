import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import type { Entitlement } from "@/lib/entitlements/types";

export type PartnerUser = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: PartnerRole;
  status: "active" | "revoked";
  invited_at: string;
  accepted_at: string | null;
  deactivated_at: string | null;
  has_password: boolean;
};

type MembershipRow = Omit<PartnerUser, "id" | "name" | "email" | "has_password"> & { id: string };

function one<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function listPartnerUsers(tenantId: string, partnerId: string): Promise<PartnerUser[]> {
  const supabase = getSupabaseServiceClient();
  const { data: memberships, error } = await supabase
    .from("partner_users")
    .select("id, user_id, role, status, invited_at, accepted_at, deactivated_at")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .order("invited_at", { ascending: true });
  if (error) throw new Error(`Could not load partner users: ${error.message}`);

  const rows = (memberships ?? []) as unknown as MembershipRow[];
  if (rows.length === 0) return [];
  const { data: users, error: userError } = await supabase
    .from("users")
    .select("id, name, email, password_hash")
    .in("id", rows.map((row) => row.user_id));
  if (userError) throw new Error(`Could not load partner user accounts: ${userError.message}`);

  const byId = new Map((users ?? []).map((user) => [user.id, user]));
  return rows.flatMap((row) => {
    const user = byId.get(row.user_id);
    if (!user) return [];
    return [{ ...row, name: user.name, email: user.email, has_password: Boolean(user.password_hash) } as PartnerUser];
  });
}

export async function invitePartnerUser(params: {
  tenantId: string;
  partnerId: string;
  name: string;
  email: string;
  role: PartnerRole;
  tokenHash: string;
  expiresAt: string;
  maxPartnerUsers?: Entitlement["limits"]["max_partner_users"];
}): Promise<{ user_id: string; tenant_id: string; partner_id: string; name: string; email: string; role: PartnerRole; invited_at: string }> {
  const { data, error } = await getSupabaseServiceClient().rpc("partner_invite_user_with_limit", {
    p_tenant_id: params.tenantId,
    p_partner_id: params.partnerId,
    p_name: params.name,
    p_email: params.email,
    p_role: params.role,
    p_token_hash: params.tokenHash,
    p_expires_at: params.expiresAt,
    p_max_partner_users: params.maxPartnerUsers ?? null,
  });
  const result = one(data as unknown as { user_id: string; tenant_id: string; partner_id: string; name: string; email: string; role: PartnerRole; invited_at: string }[] | { user_id: string; tenant_id: string; partner_id: string; name: string; email: string; role: PartnerRole; invited_at: string } | null);
  if (error || !result) throw new Error(error?.message ?? "Could not invite partner user");
  return result;
}

export async function resendPartnerInvite(params: { tenantId: string; partnerId: string; userId: string; tokenHash: string; expiresAt: string }): Promise<{ user_id: string; name: string; email: string }> {
  const { data, error } = await getSupabaseServiceClient().rpc("partner_resend_invite", {
    p_tenant_id: params.tenantId,
    p_partner_id: params.partnerId,
    p_user_id: params.userId,
    p_token_hash: params.tokenHash,
    p_expires_at: params.expiresAt,
  });
  const result = one(data as unknown as { user_id: string; name: string; email: string }[] | { user_id: string; name: string; email: string } | null);
  if (error || !result) throw new Error(error?.message ?? "Could not resend partner invitation");
  return result;
}

export async function setPartnerUserStatus(params: { tenantId: string; partnerId: string; userId: string; status: "active" | "revoked"; maxPartnerUsers?: number | null }): Promise<{ old_status: "active" | "revoked"; new_status: "active" | "revoked" }> {
  const { data, error } = await getSupabaseServiceClient().rpc("partner_set_user_status_with_limit", {
    p_tenant_id: params.tenantId,
    p_partner_id: params.partnerId,
    p_user_id: params.userId,
    p_status: params.status,
    p_max_partner_users: params.maxPartnerUsers ?? null,
  });
  const result = one(data as unknown as { old_status: "active" | "revoked"; new_status: "active" | "revoked" }[] | { old_status: "active" | "revoked"; new_status: "active" | "revoked" } | null);
  if (error || !result) throw new Error(error?.message ?? "Could not change partner user status");
  return result;
}
