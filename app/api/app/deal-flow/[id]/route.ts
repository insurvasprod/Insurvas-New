import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { dealFlowProducer, updateDealFlow } from "@/lib/dealFlow/service";
import { rowVisible, scopeFor } from "@/lib/agency/visibility";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  try {
    const id = (await params).id;
    // AG-0.5: a deal credited to a producer outside this session's scope is answered as not found, so it
    // can be neither edited nor confirmed to exist. No read for a solo tenant or an all-seeing role.
    const scope = await scopeFor(auth.context);
    if (scope !== null && !rowVisible(scope, await dealFlowProducer(auth.context.tenantId, id))) return NextResponse.json({ error: "Deal flow row not found" }, { status: 404 });
    const { deal, changes } = await updateDealFlow(auth.context.tenantId, id, body ?? {});
    // Old → new for every field that actually changed, not just the names sent.
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.deal_flow_updated", targetType: "deal_flow", targetId: deal.id, metadata: { fields: Object.keys(changes), changes }, request });
    return NextResponse.json({ deal });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update deal flow" }, { status: 400 }); }
}
