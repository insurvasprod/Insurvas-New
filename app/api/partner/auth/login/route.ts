import { NextResponse, type NextRequest } from "next/server";

import { getMaintenanceStatus } from "@/lib/system/service";
import { partnerLoginSchema } from "@/lib/partnerAuth/schemas";
import { PARTNER_SESSION_COOKIE, partnerSessionCookieOptions, signPartnerSessionToken } from "@/lib/partnerAuth/session";
import { verifyPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { recordLoginEvent } from "@/lib/loginEvents/record";

const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeOG1JDFsDLK7g7HDkVK6PmVNv7HDvXe5S";
const GENERIC_ERROR = { error: "Invalid email or password" };

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") return NextResponse.json({ error: maintenance.message, code: "maintenance_locked" }, { status: 503 });
  const parsed = partnerLoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(GENERIC_ERROR, { status: 401 });

  const { email, password } = parsed.data;
  const supabase = getSupabaseServiceClient();
  const { data: user } = await supabase.from("users").select("id, password_hash, status").eq("email", email).maybeSingle<{ id: string; password_hash: string | null; status: string }>();
  const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.password_hash || !passwordOk) {
    await recordLoginEvent({ request, email, success: false, userId: user?.id ?? null, actorType: "user", failureReason: !user?.password_hash ? "no_password_set" : "invalid_credentials" });
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
    await recordLoginEvent({ request, email, success: false, userId: user.id, actorType: "user", failureReason: user.status === "suspended" ? "suspended" : "no_membership" });
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  await supabase.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
  await recordLoginEvent({ request, email, success: true, userId: user.id, actorType: "user" });
  const token = await signPartnerSessionToken(user.id, membership.tenant_id, membership.partner_id);
  const response = NextResponse.json({ ok: true, redirectTo: "/partner" });
  response.cookies.set(PARTNER_SESSION_COOKIE, token, partnerSessionCookieOptions);
  return response;
}
