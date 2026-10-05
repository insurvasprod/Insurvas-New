import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { holdsAgencyMembership } from "@/lib/auth/planeSeparation";
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
  /** users.last_login_at — the last successful sign-in (p-par-team "Last activity"), not presence. */
  last_login_at: string | null;
  /** For an invitation nobody has accepted: when its newest link stops working. */
  invite_expires_at: string | null;
  /** Null means this legacy partner user has not yet been assigned to an admin. */
  partner_admin_user_id: string | null;
};

type MembershipRow = Omit<PartnerUser, "id" | "name" | "email" | "has_password" | "last_login_at" | "invite_expires_at"> & { id: string };

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
  // The hierarchy migration is deliberately additive. Until it has been applied in an environment,
  // the legacy table has no assignment column and the existing Publisher page must still load.
  const { data: assignments, error: assignmentError } = await supabase
    .from("partner_users")
    .select("user_id, partner_admin_user_id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId);
  if (!assignmentError) {
    const adminByUserId = new Map((assignments ?? []).map((assignment) => [assignment.user_id, assignment.partner_admin_user_id as string | null]));
    for (const row of rows) row.partner_admin_user_id = adminByUserId.get(row.user_id) ?? null;
  } else if (assignmentError.code !== "42703") {
    throw new Error(`Could not load partner user assignments: ${assignmentError.message}`);
  }
  if (rows.length === 0) return [];
  const { data: users, error: userError } = await supabase
    .from("users")
    .select("id, name, email, password_hash, last_login_at")
    .in("id", rows.map((row) => row.user_id));
  if (userError) throw new Error(`Could not load partner user accounts: ${userError.message}`);

  // The newest open invitation per pending member, for "Expires 24 Sep 09:00". A reissued link
  // replaces the old one, so the newest row is the one that works.
  const pendingIds = rows.filter((row) => row.status === "active" && !row.accepted_at).map((row) => row.user_id);
  const expiresByUser = new Map<string, string>();
  if (pendingIds.length) {
    const { data: invitations, error: invitationError } = await supabase
      .from("user_invitations")
      .select("user_id, expires_at, created_at")
      .in("user_id", pendingIds)
      .eq("partner_id", partnerId)
      .eq("purpose", "invite")
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    if (invitationError) throw new Error(`Could not load partner invitations: ${invitationError.message}`);
    for (const invitation of (invitations ?? []) as Array<{ user_id: string; expires_at: string }>) {
      if (!expiresByUser.has(invitation.user_id)) expiresByUser.set(invitation.user_id, invitation.expires_at);
    }
  }

  const byId = new Map((users ?? []).map((user) => [user.id, user]));
  return rows.flatMap((row) => {
    const user = byId.get(row.user_id);
    if (!user) return [];
    return [{
      ...row,
      name: user.name,
      email: user.email,
      has_password: Boolean(user.password_hash),
      last_login_at: (user as { last_login_at?: string | null }).last_login_at ?? null,
      invite_expires_at: expiresByUser.get(row.user_id) ?? null,
    } as PartnerUser];
  });
}

export async function invitePartnerUser(params: {
  tenantId: string;
  partnerId: string;
  name: string;
  email: string;
  role: PartnerRole;
  partnerAdminUserId?: string | null;
  tokenHash: string;
  expiresAt: string;
  maxPartnerUsers?: Entitlement["limits"]["max_partner_users"];
}): Promise<{ user_id: string; tenant_id: string; partner_id: string; name: string; email: string; role: PartnerRole; invited_at: string; has_existing_password: boolean }> {
  const supabase = getSupabaseServiceClient();
  const email = params.email.trim().toLowerCase();

  // `public.users.id` references `auth.users(id)`, so a profile cannot be created by inventing a
  // uuid — which is what the older `partner_invite_user_with_limit` does, and why inviting a new
  // address returned 500 while inviting an existing one worked. Create the Auth identity first,
  // then attach it. Same sequence the tenant plane uses in app/api/app/team/route.ts.
  const { data: existing, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle<{ id: string }>();
  if (lookupError) throw new Error(`Could not check for an existing account: ${lookupError.message}`);

  // One account, one portal: an agency's own staff account is never attached to a partner
  // organisation (lib/auth/planeSeparation.ts). The routes map this to a 409.
  if (existing && await holdsAgencyMembership(existing.id)) throw new Error("agency_account: this email belongs to an agency account");

  let authUserId = existing?.id ?? null;
  if (!authUserId) {
    const created = await supabase.auth.admin.createUser({
      email,
      // Never a known value: the invitee sets their own password by redeeming the token.
      password: `Invite-${crypto.randomUUID()}!`,
      email_confirm: true,
      user_metadata: { name: params.name, full_name: params.name },
    });
    if (created.error) throw new Error(`Could not create the partner user account: ${created.error.message}`);
    authUserId = created.data.user.id;
  }

  let { data, error } = await supabase.rpc("partner_invite_user_with_auth", {
    p_auth_user_id: authUserId,
    p_tenant_id: params.tenantId,
    p_partner_id: params.partnerId,
    p_name: params.name,
    p_email: email,
    p_role: params.role,
    p_partner_admin_user_id: params.partnerAdminUserId ?? null,
    p_token_hash: params.tokenHash,
    p_expires_at: params.expiresAt,
    p_max_partner_users: params.maxPartnerUsers ?? null,
  });
  // During rollout, the pre-hierarchy RPC is still present in some environments. Fall back to
  // its legacy signature so invitations remain usable; the migration-enabled path persists the
  // inviting admin relationship above.
  if (error && /function|schema cache|partner_admin_user_id|does not exist/i.test(error.message)) {
    ({ data, error } = await supabase.rpc("partner_invite_user_with_auth", {
      p_auth_user_id: authUserId,
      p_tenant_id: params.tenantId,
      p_partner_id: params.partnerId,
      p_name: params.name,
      p_email: email,
      p_role: params.role,
      p_token_hash: params.tokenHash,
      p_expires_at: params.expiresAt,
      p_max_partner_users: params.maxPartnerUsers ?? null,
    }));
  }
  const result = one(data as unknown as { user_id: string; tenant_id: string; partner_id: string; name: string; email: string; role: PartnerRole; invited_at: string }[] | { user_id: string; tenant_id: string; partner_id: string; name: string; email: string; role: PartnerRole; invited_at: string } | null);
  if (error || !result) throw new Error(error?.message ?? "Could not invite partner user");
  const { data: user, error: userError } = await getSupabaseServiceClient().from("users").select("password_hash").eq("id", result.user_id).single<{ password_hash: string | null }>();
  if (userError) throw new Error(`Could not load invited user account: ${userError.message}`);
  return { ...result, has_existing_password: Boolean(user.password_hash) };
}

export async function resendPartnerInvite(params: { tenantId: string; partnerId: string; userId: string; tokenHash: string; expiresAt: string }): Promise<{ user_id: string; name: string; email: string; has_existing_password: boolean }> {
  const { data, error } = await getSupabaseServiceClient().rpc("partner_resend_invite", {
    p_tenant_id: params.tenantId,
    p_partner_id: params.partnerId,
    p_user_id: params.userId,
    p_token_hash: params.tokenHash,
    p_expires_at: params.expiresAt,
  });
  const result = one(data as unknown as { user_id: string; name: string; email: string }[] | { user_id: string; name: string; email: string } | null);
  if (error || !result) throw new Error(error?.message ?? "Could not resend partner invitation");
  const { data: user, error: userError } = await getSupabaseServiceClient().from("users").select("password_hash").eq("id", result.user_id).single<{ password_hash: string | null }>();
  if (userError) throw new Error(`Could not load invited user account: ${userError.message}`);
  return { ...result, has_existing_password: Boolean(user.password_hash) };
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
