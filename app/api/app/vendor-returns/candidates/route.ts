import { NextResponse, type NextRequest } from "next/server";

import { CANDIDATE_ROW_LIMIT, ReturnsRequestError, getCampaignCandidateRows } from "@/lib/vendorScorecard/returnsService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** The rows behind one campaign's claimable line (vendor_return_candidates), soonest window first. */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const rows = await getCampaignCandidateRows(auth.context.tenantId, request.nextUrl.searchParams.get("campaign_id"));
    return NextResponse.json({ rows, limit: CANDIDATE_ROW_LIMIT }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReturnsRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the claimable rows" }, { status: 400 });
  }
}
