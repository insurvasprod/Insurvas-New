import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { loadTenantUsers } from "@/lib/adminTenantUsers/queries";
import { revokeTenantInvite } from "@/lib/tenantTeam/service";

const bodySchema = z.object({ expected: z.number().int().min(1).max(1000) });

/**
 * Revokes every stale invitation of one tenant: not accepted, and the invitation has expired
 * (user_invitations.expires_at < now()). super_admin only.
 *
 * The body carries the count the confirmation showed. If the tenant has moved on since (someone
 * accepted, an owner revoked one, another expired) the request is refused with the new count rather
 * than revoking a different set than the one the admin agreed to.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id: tenantId } = await params;
  if (!z.string().uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "That tenant identifier is not valid" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say how many invitations the confirmation showed" }, { status: 400 });

  let stale;
  try {
    stale = (await loadTenantUsers(tenantId)).members.filter((member) => member.stale);
  } catch (error) {
    console.error("[admin tenant users] could not list stale invites", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load this tenant's invitations" }, { status: 500 });
  }

  if (stale.length !== parsed.data.expected) {
    return NextResponse.json(
      { error: `There are now ${stale.length} expired invitation${stale.length === 1 ? "" : "s"}, not ${parsed.data.expected}. Nothing was revoked; look again and confirm.`, current: stale.length },
      { status: 409 },
    );
  }

  const revoked: string[] = [];
  const failed: string[] = [];
  for (const member of stale) {
    try {
      const result = await revokeTenantInvite(tenantId, member.id);
      revoked.push(member.id);
      await audit({
        actorId: auth.session.sub,
        action: "tenant.member_invite_revoked",
        targetType: "user",
        targetId: member.id,
        metadata: { tenantId, email: result.email, accountRemoved: result.accountRemoved, expiredAt: member.inviteExpiresAt, via: "admin_stale_invites" },
        request,
      });
    } catch (error) {
      failed.push(member.email);
      console.error("[admin tenant users] stale invite revoke failed", member.id, error instanceof Error ? error.message : error);
    }
  }

  await audit({
    actorId: auth.session.sub,
    action: "tenant.stale_invites_revoked",
    targetType: "tenant",
    targetId: tenantId,
    metadata: { revoked: revoked.length, failed },
    request,
  });

  if (failed.length) {
    return NextResponse.json(
      { ok: false, revoked: revoked.length, error: `Revoked ${revoked.length}; could not revoke ${failed.join(", ")}.` },
      { status: 207 },
    );
  }
  return NextResponse.json({ ok: true, revoked: revoked.length });
}
