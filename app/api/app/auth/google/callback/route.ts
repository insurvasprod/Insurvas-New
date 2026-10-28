import { NextResponse, type NextRequest } from "next/server";
import { isDisposableEmail } from "disposable-email-domains-js";

import { checkLoginAllowed, logBlockedLoginAttempt } from "@/lib/authProtection";
import { holdsPartnerMembership, WRONG_PORTAL_CODE } from "@/lib/auth/planeSeparation";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMaintenanceStatus } from "@/lib/system/service";
import { completeTenantSignIn } from "@/lib/tenantAuth/completeSignIn";
import { finishGoogleSignIn, GOOGLE_FLOW_COOKIE, googleAccountState, googleFlowCookieOptions, googleProfile, parseGoogleFlow } from "@/lib/tenantAuth/google";
import { GOOGLE_SIGNUP_COOKIE, googleSignupCookieOptions, signGoogleSignupToken } from "@/lib/tenantAuth/session";
import { TENANT_SUSPENDED_CODE } from "@/lib/tenants/suspension";
import { recordSecurityEvent } from "@/lib/users/securityEvents";

/**
 * Google comes back here (2026-10-27). The code is exchanged for the Auth user, then:
 *  - an Insurvas account → completeTenantSignIn, exactly as a password would (suspension, the
 *    partner plane, two-factor, the session);
 *  - a new address → "Finish your account" on step 1, carried by a signed twenty-minute cookie;
 *    nothing is created until the person finishes, on either door.
 * Every refusal goes back to the door with a fixed reason; no text from the URL is ever shown.
 */
export async function GET(request: NextRequest) {
  const flow = parseGoogleFlow(request.cookies.get(GOOGLE_FLOW_COOKIE)?.value);
  const door = new URL(flow?.intent === "sign-up" ? "/signup" : "/app/login", request.url);

  /** Back to the door with a reason the page turns into a sentence; the flow cookie goes either way. */
  const refuse = (reason: string) => {
    door.searchParams.set("google", reason);
    const response = NextResponse.redirect(door);
    response.cookies.set(GOOGLE_FLOW_COOKIE, "", { ...googleFlowCookieOptions, maxAge: 0 });
    return response;
  };

  const params = request.nextUrl.searchParams;
  // The person closed Google's chooser, or Google refused.
  if (params.get("error")) return refuse("cancelled");
  const code = params.get("code");
  if (!code) return refuse("failed");
  // Another browser, cookies cleared, or more than ten minutes at Google.
  if (!flow) return refuse("expired");

  const maintenance = await getMaintenanceStatus().catch(() => null);
  if (maintenance?.level === "locked") return refuse("maintenance");

  const user = await finishGoogleSignIn(code, flow.verifier);
  const profile = user ? googleProfile(user) : null;
  if (!profile) return refuse("failed");
  // Only an address Google itself vouches for is accepted, for sign-in and sign-up alike.
  if (!profile.verified) return refuse("unverified");

  // The same per-address and per-IP lockout as the password.
  const protection = await checkLoginAllowed("user", profile.email, request);
  if (!protection.allowed) {
    logBlockedLoginAttempt("user", profile.email, request, protection);
    return refuse("locked");
  }

  const supabase = getSupabaseServiceClient();
  const { data: existing } = await supabase.from("users").select("id, status").eq("id", profile.authUserId).maybeSingle<{ id: string; status: string }>();
  // A row alone is not an account: the auth trigger gives every new Auth user an "invited" row,
  // this Google login included (googleAccountState).
  const [{ count: agencyCount }, isPartner] = existing
    ? await Promise.all([
        supabase.from("tenant_users").select("tenant_id", { count: "exact", head: true }).eq("user_id", existing.id),
        holdsPartnerMembership(existing.id),
      ])
    : [{ count: 0 }, false];
  const state = googleAccountState(existing, { agency: agencyCount ?? 0, partner: isPartner ? 1 : 0 });
  if (state === "invited") return refuse("invited");

  if (existing && state === "account") {
    if (profile.newlyLinked) {
      await recordSecurityEvent({ userId: existing.id, tenantId: null, type: "google_sign_in_added", detail: { email: profile.email }, request });
    }
    const result = await completeTenantSignIn({ request, authUserId: profile.authUserId, email: profile.email, remember: true, via: "google" });
    const body = (await result.clone().json().catch(() => null)) as { ok?: boolean; redirectTo?: string; twoFactor?: boolean; code?: string } | null;

    let response: NextResponse;
    if (result.ok && body?.twoFactor) response = NextResponse.redirect(new URL("/app/login?step=code", request.url));
    else if (result.ok) response = NextResponse.redirect(new URL(body?.redirectTo ?? "/app/dashboard", request.url));
    else {
      const reason = body?.code === WRONG_PORTAL_CODE ? "partner" : body?.code === TENANT_SUSPENDED_CODE ? "agency-suspended" : result.status === 403 ? "account-suspended" : existing.status !== "active" && existing.status !== "pending_verification" ? "inactive" : "refused";
      return refuse(reason);
    }
    // The session, the pending two-factor cookie and the cleared partner session, as the sign-in set them.
    for (const cookie of result.cookies.getAll()) response.cookies.set(cookie);
    response.cookies.set(GOOGLE_FLOW_COOKIE, "", { ...googleFlowCookieOptions, maxAge: 0 });
    return response;
  }

  // The address already has a password account that Supabase did not link to Google: say so,
  // rather than starting a second sign-up that the database would refuse.
  // Another row with this address, not the one the trigger just made for this same Auth user.
  const { data: byEmail } = await supabase.from("users").select("id").eq("email", profile.email).neq("id", profile.authUserId).limit(1).maybeSingle<{ id: string }>();
  if (byEmail) return refuse("exists");
  if (isDisposableEmail(profile.email)) return refuse("disposable");

  const token = await signGoogleSignupToken({ sub: profile.authUserId, email: profile.email, name: profile.name, plan: flow.plan, cycle: flow.cycle });
  const response = NextResponse.redirect(new URL("/signup?google=finish", request.url));
  response.cookies.set(GOOGLE_SIGNUP_COOKIE, token, googleSignupCookieOptions);
  response.cookies.set(GOOGLE_FLOW_COOKIE, "", { ...googleFlowCookieOptions, maxAge: 0 });
  return response;
}
