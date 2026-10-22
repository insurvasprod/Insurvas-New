import "server-only";

/**
 * The three account-lifecycle emails.
 *
 * These were `console.info` stubs until SA-4.11 chose a provider. They now go through the shared
 * transport, which means the wording lives in templates.ts, the attempt is written to email_log
 * either way, and an unconfigured mail server produces a `skipped` row rather than silence.
 *
 * The return shape is unchanged, deliberately. Callers already branch on `delivered` to decide
 * whether to show the admin a copyable link, and that behaviour is still exactly right — a link
 * the admin can pass on by hand is the correct fallback when the mail server is down.
 */

import { sendEmail } from "./transport.ts";
import {
  emailChangeConfirmationEmail,
  invitationEmail,
  partnerInvitationEmail,
  passwordResetEmail,
  teamInvitationEmail,
} from "./templates.ts";
import { getSupabaseServiceClient } from "../supabase/service.ts";
import { partnerRoleLabel, type PartnerRole } from "../partnerAuth/roles.ts";
import { isAgencyTitle, MEMBER_ROLE_LABELS, type MemberRole } from "../tenantAuth/roles.ts";

/** Names for the invitation's wording. A failed read falls back to neutral words, never blocks the send. */
async function namesFor(ids: { tenantId?: string | null; partnerId?: string | null; inviterId?: string | null }) {
  const supabase = getSupabaseServiceClient();
  const [tenant, partner, inviter] = await Promise.all([
    ids.tenantId ? supabase.from("tenants").select("name").eq("id", ids.tenantId).maybeSingle<{ name: string | null }>() : null,
    ids.partnerId && ids.tenantId ? supabase.from("partners").select("name").eq("tenant_id", ids.tenantId).eq("id", ids.partnerId).maybeSingle<{ name: string | null }>() : null,
    ids.inviterId ? supabase.from("users").select("name").eq("id", ids.inviterId).maybeSingle<{ name: string | null }>() : null,
  ]);
  return {
    tenantName: tenant?.data?.name?.trim() || null,
    partnerName: partner?.data?.name?.trim() || null,
    inviterName: inviter?.data?.name?.trim() || null,
  };
}

/** A partner user invited to the partner portal (by the agency, or by their own partner admin). */
export async function sendPartnerInvitationEmail(params: {
  to: string;
  name: string;
  inviteUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId: string;
  partnerId: string;
  /** Read from partner_users when the caller does not have it (a resend). */
  role?: PartnerRole | null;
  existingAccount: boolean;
}): Promise<{ delivered: boolean }> {
  const [names, storedRole] = await Promise.all([
    namesFor({ tenantId: params.tenantId, partnerId: params.partnerId }),
    params.role || !params.userId
      ? null
      : getSupabaseServiceClient().from("partner_users").select("role").eq("tenant_id", params.tenantId).eq("partner_id", params.partnerId).eq("user_id", params.userId).maybeSingle<{ role: PartnerRole | null }>(),
  ]);
  const rendered = partnerInvitationEmail({
    name: params.name,
    inviteUrl: params.inviteUrl,
    expiresAt: params.expiresAt,
    agencyName: names.tenantName ?? "Your agency",
    partnerName: names.partnerName ?? "your organisation",
    roleLabel: partnerRoleLabel(params.role ?? storedRole?.data?.role ?? "partner_user"),
    existingAccount: params.existingAccount,
  });
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.invitation",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}

/** A teammate invited into a workspace: a producer, admin, manager, setter… in an agency or a solo agent's team. */
export async function sendTeamInvitationEmail(params: {
  to: string;
  name: string;
  inviteUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId: string;
  inviterId?: string | null;
  /** Read from tenant_users when the caller does not have it (a resend). */
  role?: MemberRole | null;
  audience: "agency" | "individual";
  /** When unknown, the same rule the set-password page uses: the account is already active. */
  existingAccount?: boolean;
}): Promise<{ delivered: boolean }> {
  const supabase = getSupabaseServiceClient();
  const userId = params.userId ?? null;
  const [names, member, user] = await Promise.all([
    namesFor({ tenantId: params.tenantId, inviterId: params.inviterId }),
    !params.role && userId ? supabase.from("tenant_users").select("role, agency_role").eq("tenant_id", params.tenantId).eq("user_id", userId).maybeSingle<{ role: string; agency_role: string | null }>() : null,
    params.existingAccount === undefined && userId ? supabase.from("users").select("status").eq("id", userId).maybeSingle<{ status: string | null }>() : null,
  ]);
  const stored = member?.data ? (isAgencyTitle(member.data.agency_role) ? member.data.agency_role : member.data.role) : null;
  const role = (params.role ?? stored ?? "producer") as MemberRole;
  const rendered = teamInvitationEmail({
    name: params.name,
    inviteUrl: params.inviteUrl,
    expiresAt: params.expiresAt,
    workspaceName: names.tenantName ?? "your team",
    inviterName: names.inviterName,
    role,
    roleLabel: MEMBER_ROLE_LABELS[role] ?? role,
    audience: params.audience,
    existingAccount: params.existingAccount ?? user?.data?.status === "active",
  });
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.invitation",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}

export async function sendInvitationEmail(params: {
  to: string;
  name: string;
  inviteUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ delivered: boolean }> {
  const rendered = invitationEmail(params);
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.invitation",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}

export async function sendExistingPartnerInvitationEmail(params: {
  to: string;
  name: string;
  inviteUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ delivered: boolean }> {
  const rendered = invitationEmail({ ...params, existingAccount: true });
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.invitation",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}

/** SA-1.3's "send password reset link". */
export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ delivered: boolean }> {
  const rendered = passwordResetEmail(params);
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.password_reset",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}

/**
 * Goes to the NEW address — that is the whole point: it proves the person controls it before the
 * change takes effect.
 */
export async function sendEmailChangeConfirmation(params: {
  to: string;
  name: string;
  confirmUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ delivered: boolean }> {
  const rendered = emailChangeConfirmationEmail(params);
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.email_change_confirmation",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}
