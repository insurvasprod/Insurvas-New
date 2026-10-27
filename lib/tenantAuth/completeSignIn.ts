import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { isTenantRole } from "@/lib/tenantAuth/roles";
import { pickLoginMembership } from "@/lib/tenantAuth/workspaces";
import {
  membershipsOutsideSuspendedTenants,
  TENANT_SUSPENDED_CODE,
  TENANT_SUSPENDED_MESSAGE,
} from "@/lib/tenants/suspension";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { holdsPartnerMembership, PARTNER_ACCOUNT_AT_AGENT_SIGN_IN, WRONG_PORTAL_CODE } from "@/lib/auth/planeSeparation";
import {
  signTenantPending2faToken,
  tenantPending2faCookieOptions,
  tenantSessionCookie,
  TENANT_PENDING_2FA_COOKIE,
  TENANT_SESSION_COOKIE,
  TENANT_TRUSTED_DEVICE_COOKIE,
  verifyTenantTrustedDeviceToken,
  type TenantSignInLink,
  type TenantTrustedDevice,
} from "@/lib/tenantAuth/session";
import { issueTenantSession } from "@/lib/tenantAuth/sessionStore";
import { twoFactorEnabledAt } from "@/lib/tenantAuth/twoFactor";
import { requiresTwoFactor } from "@/lib/tenantAuth/securityRules";
import { partnerSessionCookieOptions, PARTNER_SESSION_COOKIE } from "@/lib/partnerAuth/session";
import { recordLastLogin, recordLoginEvent, type LoginFailureReason } from "@/lib/loginEvents/record";
import { recordSecurityEvent } from "@/lib/users/securityEvents";
import { signupDestination } from "@/lib/signup/context";
import { firstLoginLanding } from "@/lib/dashboard/setupViewer";
import { clearLoginFailures, recordLoginFailure } from "@/lib/authProtection";

/**
 * Everything an agent sign-in does once the first factor has named the person (Google sign-in
 * plan B1, 2026-10-27): the user row and its status, the partner-plane refusal, the workspace pick,
 * suspended agencies, two-factor and trusted devices, the session row and cookie, and the signup
 * redirect. The password, the emailed link and Google all end here, so no way in can skip a check. Moved verbatim from app/api/app/auth/login/route.ts; behaviour is unchanged.
 */

// Same anti-enumeration shape as admin login: identical response whether or not the email
// exists. Credential verification belongs to Supabase Auth; the public profile table only carries
// tenant membership, status, and the session version used by the application cookie.
export const GENERIC_ERROR = { error: "Invalid email or password" };

// One answer for a link that has expired, was used, or was never ours.
export const LINK_ERROR = { error: "That sign-in link has expired or was already used. Ask for a new one." };

/** How the person proved who they are. */
export type SignInVia = "password" | "link" | "google";

/**
 * Records a failed attempt, then returns the response — so no failure path can forget to log.
 * The route uses it for a wrong password; completeTenantSignIn for everything after.
 */
export function signInFailure(request: NextRequest, email: string) {
  return async function fail(reason: LoginFailureReason, userId: string | null, response: NextResponse, countFailure = true) {
    await Promise.all([
      recordLoginEvent({ request, email, success: false, userId, actorType: "user", failureReason: reason }),
      countFailure ? recordLoginFailure("user", email, request) : Promise.resolve(),
    ]);
    return response;
  };
}

/**
 * Claims a sign-in link's id once. Unlike the rate limiter's own `claim`, this fails CLOSED: a link
 * that cannot be checked is refused, and the password is still there.
 */
async function claimLinkOnce(jti: string): Promise<boolean> {
  const { data, error } = await getSupabaseServiceClient().rpc("claim_rate_limit", { p_key: `sign_in_link:${jti}`, p_max: 1, p_window_seconds: 3600 });
  if (error) {
    console.error("[sign-in link] could not claim the link, refusing it:", error.message);
    return false;
  }
  return data === true;
}

/** This browser's "trust this device" cookie, when it is still good for this person and authenticator. */
async function trustedDeviceFor(request: NextRequest, userId: string, sessionVersion: number, enabledAt: string): Promise<TenantTrustedDevice | null> {
  const token = request.cookies.get(TENANT_TRUSTED_DEVICE_COOKIE)?.value;
  const trusted = token ? await verifyTenantTrustedDeviceToken(token) : null;
  if (!trusted || trusted.sub !== userId || trusted.sessionVersion !== sessionVersion || trusted.enabledAt !== enabledAt) return null;
  return trusted;
}

export async function completeTenantSignIn({ request, authUserId, email, remember, via, link = null }: {
  request: NextRequest;
  /** The Supabase Auth user id the first factor proved. The only identity accepted from it. */
  authUserId: string;
  email: string;
  remember: boolean;
  via: SignInVia;
  /** The emailed link, when that was the first factor: it is checked against the user row here. */
  link?: TenantSignInLink | null;
}): Promise<NextResponse> {
  const supabase = getSupabaseServiceClient();
  const fail = signInFailure(request, email);

  // No tenant is known yet at this point, so the profile lookup must run unscoped through the
  // service-role client. The auth user id is the only identity accepted from Supabase Auth.
  const { data: user } = await supabase
    .from("users")
    .select("id, status, session_version, last_login_at")
    .eq("id", authUserId)
    .maybeSingle<{ id: string; status: string; session_version: number; last_login_at: string | null }>();

  if (!user) {
    return fail("no_membership", authUserId, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  // A link works once: the first sign-in moves last_login_at, "sign out everywhere" moves the session
  // version, and its id is claimed once here for two clicks landing at the same moment.
  if (link && (user.session_version !== link.sessionVersion || (user.last_login_at ?? null) !== link.lastLoginAt || !(await claimLinkOnce(link.jti)))) {
    return fail("invalid_credentials", user.id, NextResponse.json(LINK_ERROR, { status: 401 }));
  }

  // Past this point the caller has proven the password, so naming the account state tells them
  // nothing they don't already know — it can't be used to discover which emails exist. That's
  // how SA-1.4's "say they're suspended" and SA-00's "never reveal whether an email exists"
  // are both satisfied: wrong password always yields the generic error above.
  if (user.status === "suspended") {
    return fail(
      "suspended",
      user.id,
      NextResponse.json(
        { error: "Your account has been suspended. Contact your administrator." },
        { status: 403 },
      ),
      false,
    );
  }

  // 'inactive' stays deliberately generic — it means the person has left, and there is nothing
  // useful for them to act on.
  if (user.status !== "active" && user.status !== "pending_verification") {
    return fail("inactive", user.id, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  // A partner organisation's account never gets an agent session (lib/auth/planeSeparation.ts).
  // Past the password, so naming the right door reveals nothing the caller could not know.
  const [isPartnerAccount, { data: memberships }] = await Promise.all([
    holdsPartnerMembership(user.id),
    supabase.from("tenant_users").select("tenant_id, role, accepted_at").eq("user_id", user.id),
  ]);
  if (isPartnerAccount) {
    return fail(
      "no_membership",
      user.id,
      NextResponse.json({ error: PARTNER_ACCOUNT_AT_AGENT_SIGN_IN, code: WRONG_PORTAL_CODE }, { status: 403 }),
      false,
    );
  }

  // Every membership, not `maybeSingle`: that errored on a second row, so a person who belonged to
  // two workspaces could not sign in at all. The choice of which to open is `pickLoginMembership`;
  // the other is one "Switch workspace" away in the account menu.
  const allMemberships = (memberships ?? []) as { tenant_id: string; role: string; accepted_at: string | null }[];

  // The agencies' own state, for every membership at once. A suspended agency is never opened
  // (decision 4); a person who also belongs to a working agency signs in to that one instead.
  const { data: tenantRows } = allMemberships.length
    ? await supabase
        .from("tenants")
        .select("id, status, onboarding_state")
        .in("id", allMemberships.map((row) => row.tenant_id))
    : { data: [] };
  const tenantById = new Map(
    ((tenantRows ?? []) as { id: string; status: string; onboarding_state: string }[]).map((row) => [row.id, row]),
  );
  const statusById = new Map([...tenantById].map(([id, row]) => [id, row.status]));
  const openable = membershipsOutsideSuspendedTenants(allMemberships, statusById);
  const membership = pickLoginMembership(openable);

  // Past the password, so naming the agency's state reveals nothing the caller could not know.
  if (openable.length === 0 && allMemberships.length > 0) {
    return fail(
      "suspended",
      user.id,
      NextResponse.json({ error: TENANT_SUSPENDED_MESSAGE, code: TENANT_SUSPENDED_CODE }, { status: 403 }),
      false,
    );
  }

  if (!membership || !isTenantRole(membership.role)) {
    return fail("no_membership", user.id, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  const tenant = tenantById.get(membership.tenant_id);

  if (!tenant) {
    return fail("no_membership", user.id, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  // LA-8.2: with two-factor on, the password is only the first step. Nothing is recorded as a
  // successful sign-in until the code is (POST /api/app/auth/verify-2fa); a short-lived cookie,
  // which can never act as a session, carries the person there.
  const enabledAt = await twoFactorEnabledAt(user.id).catch(() => null);
  const enrolled = Boolean(enabledAt);
  // "Trust this device for 30 days": a cookie from an earlier code step on this browser, for this
  // person, at this session version and this authenticator, stands in for the code.
  const trusted = enabledAt ? await trustedDeviceFor(request, user.id, user.session_version, enabledAt) : null;
  // A role that can reveal an SSN or bank details, without two-factor, is sent to set it up — prompted,
  // not locked out: everything but those reveals keeps working (lib/tenantAuth/twoFactor.ts).
  // An invited member's first sign-in opens their walkthrough (Get set up, 2026-10-21); null for the owner.
  const landing = (await firstLoginLanding(membership.tenant_id, user.id, membership.role)) ?? "/app/dashboard";
  const redirectTo = signupDestination({ userStatus: user.status, onboardingState: tenant.onboarding_state })
    ?? (!enrolled && requiresTwoFactor(membership.role) ? "/app/settings?two_factor=required#my-profile/security" : landing);
  if (enrolled && !trusted) {
    await clearLoginFailures("user", email, request);
    const pending = await signTenantPending2faToken({ sub: user.id, tenantId: membership.tenant_id, sessionVersion: user.session_version, redirectTo, remember, viaLink: Boolean(link) });
    const response = NextResponse.json({ ok: true, twoFactor: true });
    response.cookies.set(TENANT_PENDING_2FA_COOKIE, pending, tenantPending2faCookieOptions);
    response.cookies.set(PARTNER_SESSION_COOKIE, "", { ...partnerSessionCookieOptions, maxAge: 0 });
    return response;
  }

  // Only a successful login moves last_login_at — failures must never touch it (SA-1.5).
  // Three independent writes, so they go out together rather than as three trips in a row.
  await Promise.all([
    clearLoginFailures("user", email, request),
    recordLastLogin("user", user.id),
    recordLoginEvent({ request, email, success: true, userId: user.id, actorType: "user" }),
    via === "link" ? recordSecurityEvent({ userId: user.id, tenantId: membership.tenant_id, type: "signed_in_with_link", request }) : Promise.resolve(),
    via === "google" ? recordSecurityEvent({ userId: user.id, tenantId: membership.tenant_id, type: "signed_in_with_google", request }) : Promise.resolve(),
  ]);

  // Role is intentionally not baked into the token — it's resolved per request (SA-1.3). The token
  // names its session row, which every request checks (LA-8.2).
  // A trusted device carries the time its code was last typed, so the session counts as having passed
  // the second factor exactly as a fresh code would.
  const { token: sessionToken } = await issueTenantSession({ userId: user.id, tenantId: membership.tenant_id, sessionVersion: user.session_version, request, remember, twoFactorAt: trusted?.verifiedAt ?? null });
  const response = NextResponse.json({ ok: true, redirectTo });
  response.cookies.set(TENANT_SESSION_COOKIE, sessionToken, tenantSessionCookie(remember));
  // A successful agent login switches the browser to the agent identity plane. Clear any stale
  // partner session so a previous partner user cannot remain authenticated in another portal tab.
  response.cookies.set(PARTNER_SESSION_COOKIE, "", { ...partnerSessionCookieOptions, maxAge: 0 });
  return response;
}
