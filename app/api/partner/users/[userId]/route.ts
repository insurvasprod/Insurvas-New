import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getEntitlement } from "@/lib/entitlements/get";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { partnerUserActionSchema } from "@/lib/partnerAuth/schemas";
import { setPartnerUserStatus } from "@/lib/partnerUsers/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!UUID.test(userId)) return NextResponse.json({ error: "Partner user not found" }, { status: 404 });
  const parsed = partnerUserActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid action" }, { status: 400 });
  const status = parsed.data.action === "deactivate" ? "revoked" : "active";
  try {
    const entitlement = await getEntitlement(auth.context.tenantId);
    await setPartnerUserStatus({
      tenantId: auth.context.tenantId,
      partnerId: auth.context.partnerId,
      userId,
      status,
      maxPartnerUsers: entitlement.limits.max_partner_users,
    });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: status === "revoked" ? "tenant.partner_user_deactivated" : "tenant.partner_user_reactivated", targetType: "partner_user", targetId: userId, metadata: { partnerId: auth.context.partnerId, actorPlane: "partner" }, request });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change user status";
    if (message.includes("not_found") || message.includes("offboarded")) return NextResponse.json({ error: "Partner user not found" }, { status: 404 });
    if (message.includes("already_in_state")) return NextResponse.json({ error: "Partner user is already in that state" }, { status: 409 });
    if (message.includes("max_partner_users")) return NextResponse.json({ error: "Partner user limit reached. Upgrade your plan or deactivate another partner user first.", code: "limit_reached", limitKey: "max_partner_users", upgrade: true }, { status: 403 });
    return NextResponse.json({ error: "Could not change user status" }, { status: 500 });
  }
}
