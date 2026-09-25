import { NextResponse, type NextRequest } from "next/server";

import { loginSchema } from "@/lib/adminAuth/schemas";
import { isAdmin2faEnabled } from "@/lib/adminAuth/config";
import { isAdminRole } from "@/lib/adminAuth/roles";
import { verifyPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
// This route issues only the pending-2FA token. The authenticated session cookie, the last-login
// stamp, the success login event and the `admin.login` audit row all belong to verify-2fa, which is
// the point at which a login has actually succeeded.
import {
  ADMIN_PENDING_2FA_COOKIE,
  pending2faCookieOptions,
  signPending2faToken,
} from "@/lib/adminAuth/session";
import { recordLoginEvent } from "@/lib/loginEvents/record";
import {
  checkLoginAllowed,
  clearLoginFailures,
  logBlockedLoginAttempt,
  loginRateLimitResponse,
  recordLoginFailure,
} from "@/lib/authProtection";

// A hash of a value nobody will ever type, used to keep the response time and
// shape identical whether or not the email exists — login must not reveal it.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeOG1JDFsDLK7g7HDkVK6PmVNv7HDvXe5S";
const GENERIC_ERROR = { error: "Invalid email or password" };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  const { email, password } = parsed.data;
  const protection = await checkLoginAllowed("admin", email, request);
  if (!protection.allowed) {
    // Scheduled after the response and capped; never delays or changes the refusal.
    logBlockedLoginAttempt("admin", email, request, protection);
    return NextResponse.json(GENERIC_ERROR, loginRateLimitResponse(protection.retryAfterSeconds));
  }

  const supabase = getSupabaseServiceClient();

  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, email, password_hash, role, is_active")
    .eq("email", email)
    .maybeSingle<{ id: string; email: string; password_hash: string; role: string; is_active: boolean }>();

  const passwordOk = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);

  if (!admin || !admin.is_active || !passwordOk || !isAdminRole(admin.role)) {
    // Failed credentials are recorded here. Successful login is recorded below when 2FA is
    // disabled, or by the verification route after the authenticator code passes.
    await Promise.all([
      recordLoginEvent({
        request,
        email,
        success: false,
        adminId: admin?.id ?? null,
        actorType: "admin",
        failureReason: admin && !admin.is_active ? "inactive" : "invalid_credentials",
      }),
      recordLoginFailure("admin", email, request),
    ]);
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  await clearLoginFailures("admin", email, request);

  // A tripwire, not a branch. `isAdmin2faEnabled()` returns the literal type `true`, so this is
  // unreachable — but what used to sit here was a complete alternative login path that issued a
  // full authenticated session and skipped the second factor entirely. TypeScript proved it dead;
  // it was still one signature change in config.ts away from being a live 2FA bypass, and SA-0.1
  // requires TOTP for every admin account with no exceptions, including the founder.
  //
  // Now a change to that config fails closed and loudly here instead.
  if (!isAdmin2faEnabled()) {
    return NextResponse.json(
      { error: "Admin two-factor authentication cannot be disabled" },
      { status: 500 },
    );
  }

  // Password alone only ever buys a short-lived `pending_2fa` token. It carries no role and
  // `verifyAdminSessionToken` rejects it, so it cannot open a single admin route on its own.
  const pendingToken = await signPending2faToken(admin.id);

  const response = NextResponse.json({ requires2fa: true });
  response.cookies.set(ADMIN_PENDING_2FA_COOKIE, pendingToken, pending2faCookieOptions);
  return response;
}
