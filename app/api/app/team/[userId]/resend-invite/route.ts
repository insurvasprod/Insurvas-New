import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { resendTenantInvite } from "@/lib/tenantTeam/service";
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";

/** Sends a teammate who has not accepted a fresh link, and retires the old one. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  }

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  try {
    const member = await resendTenantInvite({ tenantId: auth.context.tenantId, userId, tokenHash: hashInviteToken(token), expiresAt: expiresAt.toISOString() });
    const inviteUrl = buildInviteUrl(token, configuredAppOrigin("agent"));
    const { delivered } = await sendInvitationEmail({ to: member.email, name: member.name, inviteUrl, expiresAt, userId, tenantId: auth.context.tenantId });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.member_invite_resent",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId: auth.context.tenantId, email: member.email, delivered },
      request,
    });
    return NextResponse.json({ ok: true, invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "not_found") return NextResponse.json({ error: "That teammate is not in this workspace" }, { status: 404 });
    if (message === "not_pending") return NextResponse.json({ error: "This teammate has already accepted their invitation" }, { status: 409 });
    console.error("[team] failed to resend invite", message);
    return NextResponse.json({ error: "Could not resend this invitation" }, { status: 500 });
  }
}
