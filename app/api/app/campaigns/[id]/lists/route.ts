import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { listsOfCampaign } from "@/lib/campaigns/lists";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A campaign's lists (its committed imports) with their lead counts — Source › a campaign (LirF1). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", ["owner", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Vendors & campaigns");
  if (refused) return refused;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  try {
    const lists = await listsOfCampaign(auth.context.tenantId, id);
    if (!lists) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json({ lists }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load this campaign's lists" }, { status: 500 });
  }
}
