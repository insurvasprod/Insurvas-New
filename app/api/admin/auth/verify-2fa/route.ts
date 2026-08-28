import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { recordLoginEvent } from "@/lib/loginEvents/record";
import { verify2faSchema } from "@/lib/adminAuth/schemas";
import { verifyTotpCode } from "@/lib/adminAuth/totp";
import { isAdminRole } from "@/lib/adminAuth/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ADMIN_PENDING_2FA_COOKIE,
  ADMIN_SESSION_COOKIE,
  sessionCookieOptions,
  signAdminSessionToken,
  verifyPending2faToken,
} from "@/lib/adminAuth/session";

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

  const codeOk = verifyTotpCode(admin.email, admin.totp_secret, parsed.data.code);
  if (!codeOk) {
    // A run of these against one admin is the brute-force signal SA-6.2 will act on.
    await recordLoginEvent({
      request,
      email: admin.email,
      success: false,
      adminId: admin.id,
      actorType: "admin",
      failureReason: "invalid_2fa",
    });
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  await supabase.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", admin.id);

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
  response.cookies.delete(ADMIN_PENDING_2FA_COOKIE);
  return response;
}
