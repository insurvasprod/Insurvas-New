import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { updateDealFlow } from "@/lib/dealFlow/service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  try {
    const deal = await updateDealFlow(auth.context.tenantId, (await params).id, body ?? {});
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.deal_flow_updated", targetType: "deal_flow", targetId: deal.id, metadata: { fields: Object.keys(body ?? {}) }, request });
    return NextResponse.json({ deal });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update deal flow" }, { status: 400 }); }
}
