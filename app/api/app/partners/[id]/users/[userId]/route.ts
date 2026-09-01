import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { partnerUserActionSchema } from "@/lib/partnerAuth/schemas";
import { setPartnerUserStatus } from "@/lib/partnerUsers/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const OWNER_ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params;
  if (!UUID.test(partnerId) || !UUID.test(userId)) return NextResponse.json({ error: "Partner user not found" }, { status: 404 });
  const parsed = partnerUserActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid action" }, { status: 400 });
  const status = parsed.data.action === "deactivate" ? "revoked" : "active";
  try {
    await setPartnerUserStatus({ tenantId: auth.context.tenantId, partnerId, userId, status });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: status === "revoked" ? "tenant.partner_user_deactivated" : "tenant.partner_user_reactivated", targetType: "partner_user", targetId: userId, metadata: { partnerId, actorPlane: "agent" }, request });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change partner user status";
    if (message.includes("not_found") || message.includes("offboarded")) return NextResponse.json({ error: "Partner user not found" }, { status: 404 });
    if (message.includes("already_in_state")) return NextResponse.json({ error: "Partner user is already in that state" }, { status: 409 });
    return NextResponse.json({ error: "Could not change partner user status" }, { status: 500 });
  }
}
