import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getEntitlement } from "@/lib/entitlements/get";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { partnerAdminUserInviteSchema } from "@/lib/partnerAuth/schemas";
import { buildExistingPartnerInviteUrl, buildPartnerInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendExistingPartnerInvitationEmail, sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { invitePartnerUser, listPartnerUsers } from "@/lib/partnerUsers/service";

export async function GET() {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  // seatLimit is the agent's plan limit on active members of one partner organization — the same
  // number the invite and reactivate paths enforce — so "3 of 4 seats used" is the real ceiling.
  try {
    const [users, entitlement] = await Promise.all([listPartnerUsers(auth.context.tenantId, auth.context.partnerId), getEntitlement(auth.context.tenantId)]);
    return NextResponse.json({ users, seatLimit: entitlement.limits.max_partner_users ?? null });
  }
  catch { return NextResponse.json({ error: "Could not load partner users" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = partnerAdminUserInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid user details" }, { status: 400 });
  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const origin = configuredAppOrigin("partner");
  try {
    const result = await invitePartnerUser({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, ...parsed.data, partnerAdminUserId: auth.context.userId, maxPartnerUsers: (await getEntitlement(auth.context.tenantId)).limits.max_partner_users, tokenHash: hashInviteToken(token), expiresAt: expiresAt.toISOString() });
    const inviteUrl = result.has_existing_password ? buildExistingPartnerInviteUrl(token, origin) : buildPartnerInviteUrl(token, origin);
    const { delivered } = result.has_existing_password
      ? await sendExistingPartnerInvitationEmail({ to: result.email, name: result.name, inviteUrl, expiresAt, userId: result.user_id, tenantId: auth.context.tenantId })
      : await sendInvitationEmail({ to: result.email, name: result.name, inviteUrl, expiresAt, userId: result.user_id, tenantId: auth.context.tenantId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_user_invited", targetType: "partner_user", targetId: result.user_id, metadata: { partnerId: auth.context.partnerId, email: result.email, role: result.role, delivered, actorPlane: "partner" }, request });
    return NextResponse.json({ ok: true, user: { id: result.user_id, name: result.name, email: result.email, role: result.role }, invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered, mode: result.has_existing_password ? "existing_account" : "set_password" } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not invite user";
    if (message.includes("email_exists") || message.includes("duplicate key")) return NextResponse.json({ error: "This email already has partner access or a pending invitation" }, { status: 409 });
    // The same seat ceiling the agent's invite and every reactivation already enforce.
    const limit = message.match(/max_partner_users:(\d+):(\d+)/);
    if (limit) return NextResponse.json({ error: `Every seat is in use (${limit[1]} of ${limit[2]}). Deactivate a member or ask your agent for more seats.` }, { status: 409 });
    if (message.includes("account_not_active")) return NextResponse.json({ error: "This account is not active and cannot be invited" }, { status: 409 });
    if (message.includes("agency_account")) return NextResponse.json({ error: "This email belongs to an agency account. Use a separate email." }, { status: 409 });
    return NextResponse.json({ error: "Could not invite user" }, { status: 500 });
  }
}
