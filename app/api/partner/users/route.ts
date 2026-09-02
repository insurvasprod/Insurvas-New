import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { partnerUserInviteSchema } from "@/lib/partnerAuth/schemas";
import { buildPartnerInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { invitePartnerUser, listPartnerUsers } from "@/lib/partnerUsers/service";

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json({ users: await listPartnerUsers(auth.context.tenantId, auth.context.partnerId) }); }
  catch { return NextResponse.json({ error: "Could not load partner users" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = partnerUserInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid user details" }, { status: 400 });
  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  try {
    const result = await invitePartnerUser({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, ...parsed.data, tokenHash: hashInviteToken(token), expiresAt: expiresAt.toISOString() });
    const origin = process.env.NEXT_PUBLIC_PARTNER_APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const inviteUrl = buildPartnerInviteUrl(token, origin);
    const { delivered } = await sendInvitationEmail({ to: result.email, name: result.name, inviteUrl, expiresAt, userId: result.user_id, tenantId: auth.context.tenantId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_user_invited", targetType: "partner_user", targetId: result.user_id, metadata: { partnerId: auth.context.partnerId, email: result.email, role: result.role, delivered, actorPlane: "partner" }, request });
    return NextResponse.json({ ok: true, user: { id: result.user_id, name: result.name, email: result.email, role: result.role }, invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not invite user";
    if (message.includes("email_exists") || message.includes("duplicate key")) return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    return NextResponse.json({ error: "Could not invite user" }, { status: 500 });
  }
}
