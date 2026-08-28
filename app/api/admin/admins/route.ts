import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";

import { audit } from "@/lib/audit/log";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { createAdminSchema } from "@/lib/adminAuth/schemas";
import { hashPassword } from "@/lib/password";
import { generateTotpSecret, getTotpEnrollmentUri } from "@/lib/adminAuth/totp";
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
  const totpSecret = generateTotpSecret();

  const { data: created, error } = await supabase
    .from("admin_users")
    .insert({
      email,
      name,
      role,
      password_hash: passwordHash,
      totp_secret: totpSecret,
      is_active: true,
    })
    .select("id, email, name, role, is_active, created_at")
    .single();

  if (error) {
    const message = error.code === "23505" ? "An admin with this email already exists" : "Could not create admin";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "admin.created",
    targetType: "admin_user",
    targetId: created.id,
    metadata: { email, role },
    request,
  });

  const totpUri = getTotpEnrollmentUri(email, totpSecret);
  const qrDataUrl = await QRCode.toDataURL(totpUri);

  return NextResponse.json({ admin: created, totpUri, qrDataUrl }, { status: 201 });
}
