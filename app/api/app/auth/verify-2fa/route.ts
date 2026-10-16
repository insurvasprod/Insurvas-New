import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkLoginAllowed, clearLoginFailures, logBlockedLoginAttempt, loginRateLimitResponse, recordLoginFailure } from "@/lib/authProtection";
import { recordLastLogin, recordLoginEvent } from "@/lib/loginEvents/record";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { partnerSessionCookieOptions, PARTNER_SESSION_COOKIE } from "@/lib/partnerAuth/session";
import { tenantSessionCookieOptions, TENANT_PENDING_2FA_COOKIE, TENANT_SESSION_COOKIE, verifyTenantPending2faToken } from "@/lib/tenantAuth/session";
import { issueTenantSession } from "@/lib/tenantAuth/sessionStore";
import { verifySecondFactor } from "@/lib/tenantAuth/twoFactor";
import { recordSecurityEvent } from "@/lib/users/securityEvents";

/**
 * LA-8.2 (Notion sprint) · the second step of an agency sign-in: an authenticator code (each accepted
 * once) or a recovery code (each usable once). The password step left a five-minute cookie that can
 * never act as a session; this turns it into one, marked as having passed the second factor.
 *
 * Same lockout as the admin second factor: at most five wrong codes per email and address, and one
 * answer for wrong, replayed and locked out.
 */
const GENERIC_ERROR = { error: "That code is not right, or has been used." };
const bodySchema = z.union([
  z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict(),
  z.object({ recoveryCode: z.string().trim().min(10).max(20) }).strict(),
]);

export async function POST(request: NextRequest) {
  const token = request.cookies.get(TENANT_PENDING_2FA_COOKIE)?.value;
  const pending = token ? await verifyTenantPending2faToken(token) : null;
  if (!pending) return NextResponse.json({ error: "That took too long. Sign in again." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(GENERIC_ERROR, { status: 401 });

  const { data: user } = await getSupabaseServiceClient().from("users").select("id, email, status, session_version").eq("id", pending.sub)
    .maybeSingle<{ id: string; email: string; status: string; session_version: number }>();
  // The account changed in the five minutes (suspended, signed out everywhere): start again.
  if (!user || (user.status !== "active" && user.status !== "pending_verification") || user.session_version !== pending.sessionVersion) {
    return NextResponse.json({ error: "That took too long. Sign in again." }, { status: 401 });
  }

  const protection = await checkLoginAllowed("user", user.email, request, "totp");
  if (!protection.allowed) {
    logBlockedLoginAttempt("user", user.email, request, protection, "totp");
    return NextResponse.json(GENERIC_ERROR, loginRateLimitResponse(protection.retryAfterSeconds));
  }

  const kind = await verifySecondFactor(user.id, "code" in parsed.data ? { code: parsed.data.code } : { recoveryCode: parsed.data.recoveryCode });
  if (!kind) {
    await Promise.all([
      recordLoginEvent({ request, email: user.email, success: false, userId: user.id, actorType: "user", failureReason: "invalid_2fa" }),
      recordLoginFailure("user", user.email, request, "totp"),
    ]);
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  await Promise.all([
    clearLoginFailures("user", user.email, request, "totp"),
    recordLastLogin("user", user.id),
    recordLoginEvent({ request, email: user.email, success: true, userId: user.id, actorType: "user" }),
    kind === "recovery" ? recordSecurityEvent({ userId: user.id, tenantId: pending.tenantId, type: "recovery_code_used", request }) : Promise.resolve(),
  ]);
  const { token: session } = await issueTenantSession({ userId: user.id, tenantId: pending.tenantId, sessionVersion: user.session_version, request, twoFactorAt: new Date().toISOString() });
  const response = NextResponse.json({ ok: true, redirectTo: pending.redirectTo, usedRecoveryCode: kind === "recovery" });
  response.cookies.set(TENANT_SESSION_COOKIE, session, tenantSessionCookieOptions);
  response.cookies.set(TENANT_PENDING_2FA_COOKIE, "", { ...tenantSessionCookieOptions, maxAge: 0 });
  response.cookies.set(PARTNER_SESSION_COOKIE, "", { ...partnerSessionCookieOptions, maxAge: 0 });
  return response;
}
