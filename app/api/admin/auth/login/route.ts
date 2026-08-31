import { NextResponse, type NextRequest } from "next/server";

import { loginSchema } from "@/lib/adminAuth/schemas";
import { isAdmin2faEnabled } from "@/lib/adminAuth/config";
import { isAdminRole } from "@/lib/adminAuth/roles";
import { verifyPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ADMIN_PENDING_2FA_COOKIE,
  ADMIN_SESSION_COOKIE,
  pending2faCookieOptions,
  sessionCookieOptions,
  signAdminSessionToken,
  signPending2faToken,
} from "@/lib/adminAuth/session";
import { recordLoginEvent } from "@/lib/loginEvents/record";
import { audit } from "@/lib/audit/log";

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
    await recordLoginEvent({
      request,
      email,
      success: false,
      adminId: admin?.id ?? null,
      actorType: "admin",
      failureReason: admin && !admin.is_active ? "inactive" : "invalid_credentials",
    });
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  if (!isAdmin2faEnabled()) {
    await supabase.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", admin.id);

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
    const response = NextResponse.json({ requires2fa: false });
    response.cookies.set(ADMIN_SESSION_COOKIE, sessionToken, sessionCookieOptions);
    response.cookies.delete(ADMIN_PENDING_2FA_COOKIE);
    return response;
  }

  const pendingToken = await signPending2faToken(admin.id);

  const response = NextResponse.json({ requires2fa: true });
  response.cookies.set(ADMIN_PENDING_2FA_COOKIE, pendingToken, pending2faCookieOptions);
  return response;
}
