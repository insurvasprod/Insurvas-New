import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { buildPartnerInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { resendPartnerInvite } from "@/lib/partnerUsers/service";

const OWNER_ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params;
  if (!UUID.test(partnerId) || !UUID.test(userId)) return NextResponse.json({ error: "Partner user not found" }, { status: 404 });

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  try {
    const result = await resendPartnerInvite({ tenantId: auth.context.tenantId, partnerId, userId, tokenHash: hashInviteToken(token), expiresAt: expiresAt.toISOString() });
    const origin = process.env.NEXT_PUBLIC_PARTNER_APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const inviteUrl = buildPartnerInviteUrl(token, origin);
    const { delivered } = await sendInvitationEmail({ to: result.email, name: result.name, inviteUrl, expiresAt, userId: result.user_id, tenantId: auth.context.tenantId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_user_invite_resent", targetType: "partner_user", targetId: userId, metadata: { partnerId, delivered, actorPlane: "agent" }, request });
    return NextResponse.json({ ok: true, invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resend partner invitation";
    if (message.includes("not_found") || message.includes("not_pending")) return NextResponse.json({ error: "This invitation is no longer pending" }, { status: 409 });
    return NextResponse.json({ error: "Could not resend partner invitation" }, { status: 500 });
  }
}
