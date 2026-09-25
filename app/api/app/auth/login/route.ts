import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { tenantLoginSchema } from "@/lib/tenantAuth/schemas";
import { isTenantRole } from "@/lib/tenantAuth/roles";
import { pickLoginMembership } from "@/lib/tenantAuth/workspaces";
import {
  membershipsOutsideSuspendedTenants,
  TENANT_SUSPENDED_CODE,
  TENANT_SUSPENDED_MESSAGE,
} from "@/lib/tenants/suspension";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { signTenantSessionToken, tenantSessionCookieOptions, TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";
import { partnerSessionCookieOptions, PARTNER_SESSION_COOKIE } from "@/lib/partnerAuth/session";
import { recordLastLogin, recordLoginEvent, type LoginFailureReason } from "@/lib/loginEvents/record";
import { signupDestination } from "@/lib/signup/context";
import { getMaintenanceStatus } from "@/lib/system/service";
import {
  checkLoginAllowed,
  clearLoginFailures,
  logBlockedLoginAttempt,
  loginRateLimitResponse,
  recordLoginFailure,
} from "@/lib/authProtection";

// Same anti-enumeration shape as admin login: identical response whether or not the email
// exists. Credential verification belongs to Supabase Auth; the public profile table only carries
// tenant membership, status, and the session version used by the application cookie.
const GENERIC_ERROR = { error: "Invalid email or password" };

function getAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase Auth environment configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") {
    return NextResponse.json(
      {
        error: maintenance.message ?? "The platform is temporarily locked for maintenance. Please try again later.",
        code: "maintenance_locked",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = tenantLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  const { email, password } = parsed.data;
  const protection = await checkLoginAllowed("user", email, request);
  if (!protection.allowed) {
    // Scheduled after the response and capped; never delays or changes the refusal.
    logBlockedLoginAttempt("user", email, request, protection);
    return NextResponse.json(GENERIC_ERROR, loginRateLimitResponse(protection.retryAfterSeconds));
  }

  const supabase = getSupabaseServiceClient();

  /** Records the attempt, then returns the response — so no failure path can forget to log. */
  async function fail(reason: LoginFailureReason, userId: string | null, response: NextResponse, countFailure = true) {
    await Promise.all([
      recordLoginEvent({ request, email, success: false, userId, actorType: "user", failureReason: reason }),
      countFailure ? recordLoginFailure("user", email, request) : Promise.resolve(),
    ]);
    return response;
  }

  const { data: authData, error: authError } = await getAuthClient().auth.signInWithPassword({ email, password });
  if (authError || !authData.user) {
    return fail("invalid_credentials", null, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  // No tenant is known yet at this point, so the profile lookup must run unscoped through the
  // service-role client. The auth user id is the only identity accepted from Supabase Auth.
  const { data: user } = await supabase
    .from("users")
    .select("id, status, session_version")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; status: string; session_version: number }>();

  if (!user) {
    return fail("no_membership", authData.user.id, NextResponse.json(GENERIC_ERROR, { status: 401 }));
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

  // Every membership, not `maybeSingle`: that errored on a second row, so a person who belonged to
  // two workspaces could not sign in at all. The choice of which to open is `pickLoginMembership`;
  // the other is one "Switch workspace" away in the account menu.
  const { data: memberships } = await supabase
    .from("tenant_users")
    .select("tenant_id, role, accepted_at")
    .eq("user_id", user.id);
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

  // Only a successful login moves last_login_at — failures must never touch it (SA-1.5).
  // Three independent writes, so they go out together rather than as three trips in a row.
  await Promise.all([
    clearLoginFailures("user", email, request),
    recordLastLogin("user", user.id),
    recordLoginEvent({ request, email, success: true, userId: user.id, actorType: "user" }),
  ]);

  // Role is intentionally not baked into the token — it's resolved per request (SA-1.3).
  const sessionToken = await signTenantSessionToken(user.id, membership.tenant_id, user.session_version);
  const response = NextResponse.json({
    ok: true,
    redirectTo: signupDestination({ userStatus: user.status, onboardingState: tenant.onboarding_state }) ?? "/app/dashboard",
  });
  response.cookies.set(TENANT_SESSION_COOKIE, sessionToken, tenantSessionCookieOptions);
  // A successful agent login switches the browser to the agent identity plane. Clear any stale
  // partner session so a previous partner user cannot remain authenticated in another portal tab.
  response.cookies.set(PARTNER_SESSION_COOKIE, "", { ...partnerSessionCookieOptions, maxAge: 0 });
  return response;
}
