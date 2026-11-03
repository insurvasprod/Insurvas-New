import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { createAdminSchema } from "@/lib/adminAuth/schemas";
import { hashPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseServiceClient();
  const { data: admins, error } = await supabase
    .from("admin_users")
    .select("id, email, name, role, is_active, last_login_at, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Could not load admins" }, { status: 500 });
  }

  return NextResponse.json({ admins });
}

/**
 * Create a staff account. The account is born WITHOUT a second factor (`totp_secret = ''`), and
 * the response carries no secret and no QR code.
 *
 * This used to generate the new admin's TOTP secret here and hand it, with its QR code, to the
 * super_admin who made the account — so the creator held a working second factor for somebody
 * else's account. Now the new admin enrols their own authenticator at first sign-in
 * (POST /api/admin/auth/enroll-2fa, confirmed by a code in verify-2fa). 2FA stays mandatory: an
 * unenrolled account cannot finish signing in without enrolling, and verify-2fa never accepts a
 * code against the empty secret.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { email, name, role, password } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const passwordHash = await hashPassword(password);

  const { data: created, error } = await supabase
    .from("admin_users")
    .insert({
      email,
      name,
      role,
      password_hash: passwordHash,
      // Not enrolled. The admin sets up their own authenticator at first sign-in.
      totp_secret: "",
      is_active: true,
    })
    .select("id, email, name, role, is_active, created_at")
    .single();

  if (error) {
    // 409 only for the one conflict there is: the address is taken. Anything else is our failure.
    if (error.code === "23505") {
      return NextResponse.json({ error: "An admin with this email already exists" }, { status: 409 });
    }
    console.error("[admins] create failed:", error.code, error.message);
    return NextResponse.json({ error: "Could not create admin" }, { status: 500 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "admin.created",
    targetType: "admin_user",
    targetId: created.id,
    metadata: { email, role, totp_enrolment: "at_first_login" },
    request,
  });

  return NextResponse.json({ admin: created, enrolment: "at_first_login" }, { status: 201 });
}
