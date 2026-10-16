import "server-only";

import { createClient } from "@supabase/supabase-js";

import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/lib/authProtection";
import { sendEmailChangeConfirmation } from "@/lib/email/sendInvitationEmail";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";
import { signTenantSessionToken } from "@/lib/tenantAuth/session";
import { endTenantSessions, issueTenantSession, type SessionRevokeReason } from "@/lib/tenantAuth/sessionStore";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/tenantAuth/securityRules";
import { buildEmailChangeUrl, generateInviteToken, hashInviteToken } from "@/lib/users/invitations";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { recordSecurityEvent, sendSecurityNotice } from "./securityEvents";

/**
 * LA-8.2 (Notion sprint) · the account changes a person makes to their own sign-in: the password,
 * the sign-in email, and ending sessions. Each one is recorded in the security event log, and the
 * ones an attacker would want — a new password, a new email — are told to the person by email.
 */

export class AccountSecurityError extends Error {
  constructor(message: string, readonly status = 400, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

const db = () => getSupabaseServiceClient();

function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase Auth environment configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function me(userId: string) {
  const { data } = await db().from("users").select("id, email, name, session_version").eq("id", userId).maybeSingle<{ id: string; email: string; name: string; session_version: number }>();
  if (!data) throw new AccountSecurityError("Your account could not be read.", 503);
  return data;
}

/**
 * The current password, checked the way sign-in checks it — and counted the way sign-in counts a
 * wrong one, so this form cannot be used to guess a password the lockout would stop at sign-in.
 */
async function checkCurrentPassword(email: string, password: string, request: Request) {
  const protection = await checkLoginAllowed("user", email, request);
  if (!protection.allowed) throw new AccountSecurityError("Too many wrong passwords. Wait a few minutes and try again.", 429, protection.retryAfterSeconds);
  const { error } = await authClient().auth.signInWithPassword({ email, password });
  if (error) {
    await recordLoginFailure("user", email, request);
    throw new AccountSecurityError("Your current password is not right.", 400);
  }
  await clearLoginFailures("user", email, request);
}

/**
 * End every other session — by session version, which also ends cookies issued before sessions
 * were rows, and by row, which the session list reads — and hand this browser a cookie at the new
 * version, so the person pressing the button stays signed in.
 */
export async function endOtherSessions(context: TenantContext, reason: SessionRevokeReason, request: Request): Promise<{ token: string; ended: number }> {
  const user = await me(context.userId);
  const next = user.session_version + 1;
  const bumped = await db().from("users").update({ session_version: next }).eq("id", user.id).eq("session_version", user.session_version).select("id");
  if (bumped.error || !bumped.data?.length) throw new AccountSecurityError("Your sessions changed while this was running. Try again.", 409);
  const ended = await endTenantSessions({ userId: user.id, except: context.sessionId ?? null, reason, by: user.id });
  const token = context.sessionId
    ? await signTenantSessionToken(user.id, context.tenantId, next, context.sessionId)
    : (await issueTenantSession({ userId: user.id, tenantId: context.tenantId, sessionVersion: next, request, twoFactorAt: context.twoFactorAt ?? null })).token;
  return { token, ended };
}

/**
 * Change the password: the current one first, then the new one (length, not complexity rules), then
 * every other session ends and the person is emailed — so if it was not them, they know at once, and
 * if it was them because of a worry, the other sessions really are gone.
 */
export async function changePassword(context: TenantContext, current: string, next: string, request: Request): Promise<{ token: string; ended: number }> {
  if (next.length < PASSWORD_MIN) throw new AccountSecurityError(`A password needs at least ${PASSWORD_MIN} characters.`);
  if (next.length > PASSWORD_MAX) throw new AccountSecurityError(`A password can be at most ${PASSWORD_MAX} characters.`);
  if (next === current) throw new AccountSecurityError("The new password is the same as the current one.");
  const user = await me(context.userId);
  await checkCurrentPassword(user.email, current, request);
  const { error } = await db().auth.admin.updateUserById(user.id, { password: next });
  if (error) throw new AccountSecurityError(error.message || "The password could not be changed.", 400);
  const result = await endOtherSessions(context, "password_changed", request);
  await recordSecurityEvent({ userId: user.id, tenantId: context.tenantId, type: "password_changed", detail: { otherSessionsEnded: result.ended }, request });
  await sendSecurityNotice({ to: user.email, name: user.name, what: "Your password was changed", detail: "Every other session was signed out.", userId: user.id, tenantId: context.tenantId });
  return result;
}

/**
 * Ask to move the sign-in email. Nothing changes until the link sent to the NEW address is used —
 * a silently moved login address is how an account is taken over — and the OLD address is told now.
 */
export async function requestEmailChange(context: TenantContext, newEmail: string, currentPassword: string, request: Request): Promise<{ newEmail: string; expiresAt: string }> {
  const user = await me(context.userId);
  const email = newEmail.trim().toLowerCase();
  if (email === user.email.toLowerCase()) throw new AccountSecurityError("That is already your sign-in email.");
  await checkCurrentPassword(user.email, currentPassword, request);
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + 24 * 3_600_000);
  const { error } = await db().rpc("request_own_email_change" as never, { p_user_id: user.id, p_new_email: email, p_token_hash: hashInviteToken(token), p_expires_at: expiresAt.toISOString() } as never);
  if (error) {
    if (/EMAIL_ALREADY_REGISTERED/.test(error.message)) throw new AccountSecurityError("That email address already belongs to an Insurvas account.", 409);
    if (/could not find the function|PGRST202/i.test(`${error.code} ${error.message}`)) throw new AccountSecurityError("Changing your email needs a database update first.", 503);
    throw new Error(error.message);
  }
  const confirmUrl = buildEmailChangeUrl(token, configuredAppOrigin("agent"));
  await sendEmailChangeConfirmation({ to: email, name: user.name, confirmUrl, expiresAt, userId: user.id, tenantId: context.tenantId });
  await recordSecurityEvent({ userId: user.id, tenantId: context.tenantId, type: "email_change_requested", detail: { to: email }, request });
  await sendSecurityNotice({ to: user.email, name: user.name, what: "A change of sign-in email was asked for", detail: `The new address is ${email}. Nothing changes until that address confirms it.`, userId: user.id, tenantId: context.tenantId });
  return { newEmail: email, expiresAt: expiresAt.toISOString() };
}
