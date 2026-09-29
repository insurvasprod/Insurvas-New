import { NextResponse, type NextRequest } from "next/server";

import { getMaintenanceStatus } from "@/lib/system/service";
import { partnerLoginSchema } from "@/lib/partnerAuth/schemas";
import { PARTNER_SESSION_COOKIE, partnerSessionCookie, signPartnerSessionToken } from "@/lib/partnerAuth/session";
import { TENANT_SESSION_COOKIE, tenantSessionCookieOptions } from "@/lib/tenantAuth/session";
import { verifyPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AGENT_ACCOUNT_AT_PARTNER_SIGN_IN, holdsAgencyMembership, WRONG_PORTAL_CODE } from "@/lib/auth/planeSeparation";
import { recordLastLogin, recordLoginEvent } from "@/lib/loginEvents/record";
import { checkLoginAllowed, clearLoginFailures, logBlockedLoginAttempt, loginRateLimitResponse, recordLoginFailure } from "@/lib/authProtection";
import { isTenantSuspended, TENANT_SUSPENDED_CODE, TENANT_SUSPENDED_MESSAGE } from "@/lib/tenants/suspension";

const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeOG1JDFsDLK7g7HDkVK6PmVNv7HDvXe5S";
const GENERIC_ERROR = { error: "Invalid email or password" };

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") return NextResponse.json({ error: maintenance.message, code: "maintenance_locked" }, { status: 503 });
  const parsed = partnerLoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(GENERIC_ERROR, { status: 401 });

  const { email, password, remember } = parsed.data;
  const protection = await checkLoginAllowed("user", email, request);
  if (!protection.allowed) {
    // Scheduled after the response and capped; never delays or changes the refusal.
    logBlockedLoginAttempt("user", email, request, protection);
    return NextResponse.json(GENERIC_ERROR, loginRateLimitResponse(protection.retryAfterSeconds));
  }

  const supabase = getSupabaseServiceClient();
  const { data: user } = await supabase.from("users").select("id, password_hash, status, session_version").eq("email", email).maybeSingle<{ id: string; password_hash: string | null; status: string; session_version: number }>();
  const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.password_hash || !passwordOk) {
    await Promise.all([
      recordLoginEvent({ request, email, success: false, userId: user?.id ?? null, actorType: "user", failureReason: !user?.password_hash ? "no_password_set" : "invalid_credentials" }),
      recordLoginFailure("user", email, request),
    ]);
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  const { data: memberships } = await supabase
    .from("partner_users")
    .select("tenant_id, partner_id, status, accepted_at, partners!inner(status)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("accepted_at", "is", null)
    .neq("partners.status", "offboarded")
    .limit(1);
  const membership = memberships?.[0] as { tenant_id: string; partner_id: string } | undefined;
  if (user.status !== "active" || !membership) {
    await Promise.all([
      recordLoginEvent({ request, email, success: false, userId: user.id, actorType: "user", failureReason: user.status === "suspended" ? "suspended" : "no_membership" }),
      recordLoginFailure("user", email, request),
    ]);
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // An agency's own account never gets a partner session (lib/auth/planeSeparation.ts). Past the
  // password, so naming the right door reveals nothing the caller could not know.
  if (await holdsAgencyMembership(user.id)) {
    await recordLoginEvent({ request, email, success: false, userId: user.id, actorType: "user", failureReason: "no_membership" });
    return NextResponse.json({ error: AGENT_ACCOUNT_AT_PARTNER_SIGN_IN, code: WRONG_PORTAL_CODE }, { status: 403 });
  }

  // The agency this partner works for must not be suspended (decision 4). Past the password, so
  // saying so tells the caller nothing they could not already know.
  const { data: tenant } = await supabase.from("tenants").select("status").eq("id", membership.tenant_id).maybeSingle<{ status: string }>();
  if (!tenant || isTenantSuspended(tenant.status)) {
    await recordLoginEvent({ request, email, success: false, userId: user.id, actorType: "user", failureReason: tenant ? "suspended" : "no_membership" });
    return tenant
      ? NextResponse.json({ error: TENANT_SUSPENDED_MESSAGE, code: TENANT_SUSPENDED_CODE }, { status: 403 })
      : NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // Independent writes, sent together — the failure path above already does the same.
  await Promise.all([
    clearLoginFailures("user", email, request),
    recordLastLogin("user", user.id),
    recordLoginEvent({ request, email, success: true, userId: user.id, actorType: "user" }),
  ]);
  const token = await signPartnerSessionToken(user.id, membership.tenant_id, membership.partner_id, user.session_version, { remember });
  const response = NextResponse.json({ ok: true, redirectTo: "/partner" });
  response.cookies.set(PARTNER_SESSION_COOKIE, token, partnerSessionCookie(remember));
  // A successful partner login switches the browser to the partner identity plane. Clear any
  // stale agent session so a previous agent cannot remain authenticated in another portal tab.
  response.cookies.set(TENANT_SESSION_COOKIE, "", { ...tenantSessionCookieOptions, maxAge: 0 });
  return response;
}
