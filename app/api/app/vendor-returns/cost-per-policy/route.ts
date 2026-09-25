import { NextResponse, type NextRequest } from "next/server";

import { ReturnsRequestError, getCampaignCostPerPolicy } from "@/lib/vendorScorecard/returnsService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * One campaign's cost per issued policy over its whole life, from the scorecard report, so a claim
 * can say what its credit would move it to. `cost` is null when the report cannot answer.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const cost = await getCampaignCostPerPolicy(auth.context.tenantId, request.nextUrl.searchParams.get("campaign_id"));
    return NextResponse.json({ cost }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReturnsRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the cost per policy" }, { status: 400 });
  }
}
