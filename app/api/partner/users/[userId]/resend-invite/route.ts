import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { buildExistingPartnerInviteUrl, buildPartnerInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendExistingPartnerInvitationEmail, sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { resendPartnerInvite } from "@/lib/partnerUsers/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!UUID.test(userId)) return NextResponse.json({ error: "Partner user not found" }, { status: 404 });

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const origin = configuredAppOrigin("partner");
  try {
    const result = await resendPartnerInvite({
      tenantId: auth.context.tenantId,
      partnerId: auth.context.partnerId,
      userId,
      tokenHash: hashInviteToken(token),
      expiresAt: expiresAt.toISOString(),
    });
    const inviteUrl = result.has_existing_password ? buildExistingPartnerInviteUrl(token, origin) : buildPartnerInviteUrl(token, origin);
    const { delivered } = result.has_existing_password ? await sendExistingPartnerInvitationEmail({
      to: result.email,
      name: result.name,
      inviteUrl,
      expiresAt,
      userId: result.user_id,
      tenantId: auth.context.tenantId,
    }) : await sendInvitationEmail({
      to: result.email,
      name: result.name,
      inviteUrl,
      expiresAt,
      userId: result.user_id,
      tenantId: auth.context.tenantId,
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.partner_user_invite_resent",
      targetType: "partner_user",
      targetId: userId,
      metadata: { partnerId: auth.context.partnerId, delivered, actorPlane: "partner" },
      request,
    });
    return NextResponse.json({ ok: true, invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered, mode: result.has_existing_password ? "existing_account" : "set_password" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resend partner invitation";
    if (message.includes("not_found") || message.includes("not_pending")) return NextResponse.json({ error: "This invitation is no longer pending" }, { status: 409 });
    return NextResponse.json({ error: "Could not resend partner invitation" }, { status: 500 });
  }
}
