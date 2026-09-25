import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getMaintenanceStatus } from "@/lib/system/service";
import { signPartnerSessionToken, PARTNER_SESSION_COOKIE, partnerSessionCookie } from "@/lib/partnerAuth/session";
import { partnerExistingInviteSchema } from "@/lib/partnerAuth/schemas";
import { isPartnerRole } from "@/lib/partnerAuth/roles";
import { TENANT_SESSION_COOKIE, tenantSessionCookieOptions } from "@/lib/tenantAuth/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hashInviteToken } from "@/lib/users/invitations";
import { verifyPassword } from "@/lib/password";
import { recordLastLogin, recordLoginEvent } from "@/lib/loginEvents/record";

const INVALID = { error: "This invitation link is invalid or has expired" };
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeOG1JDFsDLK7g7HDkVK6PmVNv7HDvXe5S";

type Invitation = { id: string; user_id: string; partner_id: string; expires_at: string; accepted_at: string | null; created_by: string | null };
type Account = { id: string; email: string; name: string; password_hash: string | null; status: string; session_version: number };

async function findInvitation(token: string): Promise<Invitation | null> {
  const { data } = await getSupabaseServiceClient()
    .from("user_invitations")
    .select("id, user_id, partner_id, expires_at, accepted_at, created_by, partners!inner(status)")
    .eq("token_hash", hashInviteToken(token))
    .eq("purpose", "invite")
    .not("partner_id", "is", null)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .neq("partners.status", "offboarded")
    .maybeSingle<Invitation>();
  return data;
}

async function findAccount(userId: string): Promise<Account | null> {
  const { data } = await getSupabaseServiceClient()
    .from("users")
    .select("id, email, name, password_hash, status, session_version")
    .eq("id", userId)
    .maybeSingle<Account>();
  return data;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json(INVALID, { status: 400 });
  const invitation = await findInvitation(token);
  if (!invitation) return NextResponse.json(INVALID, { status: 400 });
  const account = await findAccount(invitation.user_id);
  if (!account?.password_hash || account.status !== "active") return NextResponse.json(INVALID, { status: 400 });
  const db = getSupabaseServiceClient();
  const [{ data: partner }, { data: inviter }, { data: membership }] = await Promise.all([
    db.from("partners").select("name").eq("id", invitation.partner_id).maybeSingle<{ name: string }>(),
    invitation.created_by ? db.from("users").select("name").eq("id", invitation.created_by).maybeSingle<{ name: string }>() : Promise.resolve({ data: null }),
    // The role the invitation grants, from the membership it will activate.
    db.from("partner_users").select("role").eq("partner_id", invitation.partner_id).eq("user_id", invitation.user_id).maybeSingle<{ role: string }>(),
  ]);
  const role = membership && isPartnerRole(membership.role) ? membership.role : null;
  return NextResponse.json({ valid: true, email: account.email, name: account.name, partnerName: partner?.name ?? "partner workspace", invitedBy: inviter?.name ?? "Your partner admin", role, expiresAt: invitation.expires_at }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked" || maintenance.level === "read_only") {
    return NextResponse.json({ error: maintenance.message, code: maintenance.level === "locked" ? "maintenance_locked" : "maintenance_read_only" }, { status: 503 });
  }
  const parsed = partnerExistingInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  const invitation = await findInvitation(parsed.data.token);
  const account = invitation ? await findAccount(invitation.user_id) : null;
  const passwordOk = await verifyPassword(parsed.data.password, account?.password_hash ?? DUMMY_HASH);
  if (!invitation) return NextResponse.json(INVALID, { status: 400 });
  if (!account || account.status !== "active" || !account.password_hash || account.email !== parsed.data.email || !passwordOk) {
    if (account) await recordLoginEvent({ request, email: parsed.data.email, success: false, userId: account.id, actorType: "user", failureReason: "invalid_credentials" });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { data: result, error } = await getSupabaseServiceClient().rpc("consume_existing_partner_invite", { p_token_hash: hashInviteToken(parsed.data.token) });
  if (error || !result?.[0]) return NextResponse.json(INVALID, { status: 400 });
  const membership = result[0] as { user_id: string; tenant_id: string; partner_id: string; accepted_at: string };
  await recordLastLogin("user", account.id);
  await recordLoginEvent({ request, email: account.email, success: true, userId: account.id, actorType: "user" });
  await audit({ actorType: "tenant", actorId: account.id, action: "tenant.partner_user_accepted", targetType: "partner_user", targetId: account.id, metadata: { partnerId: membership.partner_id, actorPlane: "partner", existingAccount: true }, request });
  const token = await signPartnerSessionToken(account.id, membership.tenant_id, membership.partner_id, account.session_version, { remember: parsed.data.remember });
  const response = NextResponse.json({ ok: true, redirectTo: "/partner" });
  response.cookies.set(PARTNER_SESSION_COOKIE, token, partnerSessionCookie(parsed.data.remember));
  // Accepting signs this browser in to the partner plane, exactly as the partner login does: clear
  // any agent session so a previous agent cannot stay authenticated in another tab.
  response.cookies.set(TENANT_SESSION_COOKIE, "", { ...tenantSessionCookieOptions, maxAge: 0 });
  return response;
}
