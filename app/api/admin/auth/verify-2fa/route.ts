import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { recordLastLogin, recordLoginEvent } from "@/lib/loginEvents/record";
import { verify2faSchema } from "@/lib/adminAuth/schemas";
import { verifyTotpStep } from "@/lib/adminAuth/totp";
import { claimTotpStep, type TotpStepClient } from "@/lib/adminAuth/totpReplay";
import { isAdminRole } from "@/lib/adminAuth/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ADMIN_PENDING_2FA_COOKIE,
  ADMIN_SESSION_COOKIE,
  clearedAdminCookieOptions,
  sessionCookieOptions,
  signAdminSessionToken,
  verifyPending2faToken,
} from "@/lib/adminAuth/session";
import {
  checkLoginAllowed,
  clearLoginFailures,
  logBlockedLoginAttempt,
  loginRateLimitResponse,
  recordLoginFailure,
} from "@/lib/authProtection";

// One answer for a wrong code, a replayed code and a locked-out email + IP: the response never
// says which of them happened (only the status differs, 429 with Retry-After for a lockout).
const GENERIC_ERROR = { error: "Invalid or expired code" };

export async function POST(request: NextRequest) {
  const pendingToken = request.cookies.get(ADMIN_PENDING_2FA_COOKIE)?.value;
  const pending = pendingToken ? await verifyPending2faToken(pendingToken) : null;

  if (!pending) {
    return NextResponse.json({ error: "Session expired, please log in again" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = verify2faSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, email, role, totp_secret, is_active")
    .eq("id", pending.sub)
    .maybeSingle<{ id: string; email: string; role: string; totp_secret: string; is_active: boolean }>();

  if (!admin || !admin.is_active || !isAdminRole(admin.role)) {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // Lockout and rate limit, keyed on this staff email + IP in the second-factor buckets (at most
  // five wrong codes; lib/authProtection/factor.ts). Checked before the code is: a locked-out
  // caller learns nothing about whether the code they sent was right.
  const protection = await checkLoginAllowed("admin", admin.email, request, "totp");
  if (!protection.allowed) {
    // Scheduled after the response and capped; never delays or changes the refusal.
    logBlockedLoginAttempt("admin", admin.email, request, protection, "totp");
    return NextResponse.json(GENERIC_ERROR, loginRateLimitResponse(protection.retryAfterSeconds));
  }

  const step = verifyTotpStep(admin.email, admin.totp_secret, parsed.data.code);
  if (step === null) {
    await Promise.all([
      recordLoginEvent({
        request,
        email: admin.email,
        success: false,
        adminId: admin.id,
        actorType: "admin",
        failureReason: "invalid_2fa",
      }),
      recordLoginFailure("admin", admin.email, request, "totp"),
    ]);
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // Replay protection: the step must be newer than the last one accepted for this admin, and
  // claiming it is one conditional update, so two concurrent verifies cannot both pass.
  // database.types.ts predates admin_users.last_totp_step, hence the local client type.
  const claim = await claimTotpStep(supabase as unknown as TotpStepClient, admin.id, step);
  if (claim === "replayed") {
    await Promise.all([
      recordLoginEvent({
        request,
        email: admin.email,
        success: false,
        adminId: admin.id,
        actorType: "admin",
        failureReason: "replayed_2fa",
      }),
      recordLoginFailure("admin", admin.email, request, "totp"),
    ]);
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }
  if (claim === "error") {
    // Fail closed: a replay check that could not run is not a pass. Not counted as a wrong code.
    console.error("[verify-2fa] replay check failed; refusing the sign-in");
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }
  if (claim === "unavailable") {
    // 20260924364000 not applied yet: sign in as before, without the replay check.
    console.warn("[verify-2fa] admin_users.last_totp_step is missing; replay check skipped until 20260924364000 is applied");
  }

  // Only a correct, unused code clears the second-factor count. A correct password does not
  // (it clears the password bucket only), so re-entering it cannot reset the guesses.
  await clearLoginFailures("admin", admin.email, request, "totp");

  await recordLastLogin("admin", admin.id);

  // Both steps passed — this is the point the login actually succeeded.
  await recordLoginEvent({
    request,
    email: admin.email,
    success: true,
    adminId: admin.id,
    actorType: "admin",
  });

  await audit({
    actorId: admin.id,
    action: "admin.login",
    targetType: "admin_user",
    targetId: admin.id,
    request,
  });

  const sessionToken = await signAdminSessionToken(admin.id, admin.role);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, sessionToken, sessionCookieOptions);
  response.cookies.set(ADMIN_PENDING_2FA_COOKIE, "", clearedAdminCookieOptions);
  return response;
}
