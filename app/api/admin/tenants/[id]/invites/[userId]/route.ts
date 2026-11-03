import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { revokeTenantInvite } from "@/lib/tenantTeam/service";

/**
 * Staff withdraw an invitation nobody has accepted (admin tenant record › Users & seats).
 *
 * The same operation the tenant's owner has on Settings › Team & access — revokeTenantInvite removes
 * the invitation and the unaccepted membership, which frees the seat it held, and the unused account
 * when it belongs to nobody else. super_admin only: it changes who can join the agency.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id: tenantId, userId } = await params;
  if (!z.string().uuid().safeParse(tenantId).success || !z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "That invitation identifier is not valid" }, { status: 400 });
  }

  try {
    const result = await revokeTenantInvite(tenantId, userId);
    await audit({
      actorId: auth.session.sub,
      action: "tenant.member_invite_revoked",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId, email: result.email, accountRemoved: result.accountRemoved, via: "admin_tenant_record" },
      request,
    });
    return NextResponse.json({ ok: true, userId, accountRemoved: result.accountRemoved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "not_found") return NextResponse.json({ error: "That invitation is not in this tenant" }, { status: 404 });
    if (message === "not_pending") return NextResponse.json({ error: "This person has already accepted, so there is no invitation to revoke" }, { status: 409 });
    console.error("[admin tenant users] failed to revoke invite", message);
    return NextResponse.json({ error: "Could not revoke this invitation" }, { status: 500 });
  }
}
