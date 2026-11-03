import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";
import { revokeTenantInvite } from "@/lib/tenantTeam/service";

/** Revokes an invitation nobody has accepted, freeing the seat it holds. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  }

  try {
    const result = await revokeTenantInvite(auth.context.tenantId, userId);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.member_invite_revoked",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId: auth.context.tenantId, email: result.email, accountRemoved: result.accountRemoved },
      request,
    });
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "team-access", changes: [{ key: `member:${userId}`, label: `Invitation for ${result.email ?? "a teammate"}`, from: "invited", to: null, changeType: "delete" }] });
    return NextResponse.json({ ok: true, userId, accountRemoved: result.accountRemoved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "not_found") return NextResponse.json({ error: "That invitation is not in this workspace" }, { status: 404 });
    if (message === "not_pending") return NextResponse.json({ error: "This teammate has already accepted, so there is no invitation to revoke" }, { status: 409 });
    console.error("[team] failed to revoke invite", message);
    return NextResponse.json({ error: "Could not revoke this invitation" }, { status: 500 });
  }
}
