import { NextResponse, type NextRequest } from "next/server";

import { loginSchema } from "@/lib/adminAuth/schemas";
import { verifyPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { pending2faCookieOptions, signPending2faToken, ADMIN_PENDING_2FA_COOKIE } from "@/lib/adminAuth/session";
import { recordLoginEvent } from "@/lib/loginEvents/record";

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
    .select("id, password_hash, is_active")
    .eq("email", email)
    .maybeSingle<{ id: string; password_hash: string; is_active: boolean }>();

  const passwordOk = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);

  if (!admin || !admin.is_active || !passwordOk) {
    // Recorded here, not on success: this step only proves the password. The login isn't
    // complete until 2FA passes, so that route records the success (SA-1.5).
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

  const pendingToken = await signPending2faToken(admin.id);

  const response = NextResponse.json({ requires2fa: true });
  response.cookies.set(ADMIN_PENDING_2FA_COOKIE, pendingToken, pending2faCookieOptions);
  return response;
}
