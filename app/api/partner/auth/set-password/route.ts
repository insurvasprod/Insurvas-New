import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getMaintenanceStatus } from "@/lib/system/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hashInviteToken } from "@/lib/users/invitations";
import { setPasswordSchema } from "@/lib/users/schemas";
import { hashPassword } from "@/lib/password";
import { isPartnerRole } from "@/lib/partnerAuth/roles";

const INVALID = { error: "This invitation link is invalid or has expired" };

type Invitation = { id: string; user_id: string; partner_id: string; expires_at: string; accepted_at: string | null };

async function findInvitation(token: string) {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("user_invitations")
    .select("id, user_id, partner_id, expires_at, accepted_at, partners!inner(status, name)")
    .eq("token_hash", hashInviteToken(token))
    .eq("purpose", "invite")
    .not("partner_id", "is", null)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .neq("partners.status", "offboarded")
    .maybeSingle<Invitation>();
  return data;
}

async function hasPassword(userId: string): Promise<boolean> {
  const { data } = await getSupabaseServiceClient().from("users").select("password_hash").eq("id", userId).maybeSingle<{ password_hash: string | null }>();
  return Boolean(data?.password_hash);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json(INVALID, { status: 400 });
  const invitation = await findInvitation(token);
  if (!invitation) return NextResponse.json(INVALID, { status: 400 });
  if (await hasPassword(invitation.user_id)) return NextResponse.json(INVALID, { status: 400 });
  const db = getSupabaseServiceClient();
  const [{ data: user }, { data: partner }, { data: membership }] = await Promise.all([
    db.from("users").select("email, name").eq("id", invitation.user_id).maybeSingle<{ email: string; name: string }>(),
    db.from("partners").select("name").eq("id", invitation.partner_id).maybeSingle<{ name: string }>(),
    db.from("partner_users").select("role").eq("partner_id", invitation.partner_id).eq("user_id", invitation.user_id).maybeSingle<{ role: string }>(),
  ]);
  return user ? NextResponse.json({ valid: true, email: user.email, name: user.name, partnerName: partner?.name ?? "your partner organization", role: membership && isPartnerRole(membership.role) ? membership.role : null, expiresAt: invitation.expires_at }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json(INVALID, { status: 400 });
}

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked" || maintenance.level === "read_only") return NextResponse.json({ error: maintenance.message, code: maintenance.level === "locked" ? "maintenance_locked" : "maintenance_read_only" }, { status: 503 });
  const parsed = setPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid password" }, { status: 400 });
  const invitation = await findInvitation(parsed.data.token);
  if (!invitation) return NextResponse.json(INVALID, { status: 400 });
  if (await hasPassword(invitation.user_id)) return NextResponse.json(INVALID, { status: 400 });
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.rpc("consume_partner_password_token", { p_token_hash: hashInviteToken(parsed.data.token), p_password_hash: await hashPassword(parsed.data.password) });
  if (error) {
    if (error.message.includes("PARTNER_PASSWORD_TOKEN") || error.message.includes("PARTNER_MEMBERSHIP")) return NextResponse.json(INVALID, { status: 400 });
    return NextResponse.json({ error: "Could not set password" }, { status: 500 });
  }
  const { data: membership } = await supabase.from("partner_users").select("tenant_id").eq("partner_id", invitation.partner_id).eq("user_id", invitation.user_id).maybeSingle<{ tenant_id: string }>();
  await audit({ actorType: "tenant", actorId: invitation.user_id, action: "tenant.partner_user_accepted", targetType: "partner_user", targetId: invitation.user_id, metadata: { partnerId: invitation.partner_id, actorPlane: "partner" }, request });
  return NextResponse.json({ ok: true, tenantId: membership?.tenant_id ?? null });
}
