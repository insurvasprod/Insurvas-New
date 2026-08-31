import { NextResponse, type NextRequest } from "next/server";

import { tenantLoginSchema } from "@/lib/tenantAuth/schemas";
import { isTenantRole } from "@/lib/tenantAuth/roles";
import { verifyPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { signTenantSessionToken, tenantSessionCookieOptions, TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";
import { recordLoginEvent, type LoginFailureReason } from "@/lib/loginEvents/record";
import { signupDestination } from "@/lib/signup/context";
import { getMaintenanceStatus } from "@/lib/system/service";

// Same anti-enumeration shape as admin login: identical response whether or not the email
// exists, and a dummy hash compare so the timing doesn't leak it either.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeOG1JDFsDLK7g7HDkVK6PmVNv7HDvXe5S";
const GENERIC_ERROR = { error: "Invalid email or password" };

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
  const supabase = getSupabaseServiceClient();

  /** Records the attempt, then returns the response — so no failure path can forget to log. */
  async function fail(reason: LoginFailureReason, userId: string | null, response: NextResponse) {
    await recordLoginEvent({ request, email, success: false, userId, actorType: "user", failureReason: reason });
    return response;
  }

  // No tenant is known yet at this point, so this lookup must run unscoped via the
  // service-role client — the same reason admin login doesn't go through requireAdminRole.
  const { data: user } = await supabase
    .from("users")
    .select("id, password_hash, status")
    .eq("email", email)
    .maybeSingle<{ id: string; password_hash: string | null; status: string }>();

  // A null password_hash means an invited user who hasn't set one yet (SA-1.2) — they cannot
  // log in. The dummy-hash compare still runs so the response time doesn't reveal that.
  const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !user.password_hash || !passwordOk) {
    // The log distinguishes these three cases even though the caller never can.
    const reason: LoginFailureReason = !user
      ? "invalid_credentials"
      : !user.password_hash
        ? "no_password_set"
        : "invalid_credentials";
    return fail(reason, user?.id ?? null, NextResponse.json(GENERIC_ERROR, { status: 401 }));
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
    );
  }

  // 'inactive' stays deliberately generic — it means the person has left, and there is nothing
  // useful for them to act on.
  if (user.status !== "active" && user.status !== "pending_verification") {
    return fail("inactive", user.id, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .maybeSingle<{ tenant_id: string; role: string }>();

  if (!membership || !isTenantRole(membership.role)) {
    return fail("no_membership", user.id, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("onboarding_state")
    .eq("id", membership.tenant_id)
    .maybeSingle<{ onboarding_state: string }>();

  if (!tenant) {
    return fail("no_membership", user.id, NextResponse.json(GENERIC_ERROR, { status: 401 }));
  }

  // Only a successful login moves last_login_at — failures must never touch it (SA-1.5).
  await supabase.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
  await recordLoginEvent({ request, email, success: true, userId: user.id, actorType: "user" });

  // Role is intentionally not baked into the token — it's resolved per request (SA-1.3).
  const sessionToken = await signTenantSessionToken(user.id, membership.tenant_id);
  const response = NextResponse.json({
    ok: true,
    redirectTo: signupDestination({ userStatus: user.status, onboardingState: tenant.onboarding_state }) ?? "/app",
  });
  response.cookies.set(TENANT_SESSION_COOKIE, sessionToken, tenantSessionCookieOptions);
  return response;
}
