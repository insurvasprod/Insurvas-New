import { NextResponse, type NextRequest } from "next/server";

import { getScorecardSeries } from "@/lib/vendorScorecard/series";
import { assertScorecardDate, defaultScorecardPeriod } from "@/lib/vendorScorecard/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * True CPA by week (Reports round 7: each card carries a small chart of its own figure). The same gate and
 * scope as /api/app/true-cpa; the series is the same report read a bucket at a time (lib/vendorScorecard/series.ts).
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "True CPA");
  if (refused) return refused;
  try {
    const params = request.nextUrl.searchParams;
    const fallback = defaultScorecardPeriod();
    const from = params.get("from") ? assertScorecardDate(params.get("from"), "From date") : fallback.from;
    const to = params.get("to") ? assertScorecardDate(params.get("to"), "To date") : fallback.to;
    if (from > to) throw new Error("From date must be on or before To date");
    const persist = params.get("persist_days");
    const series = await getScorecardSeries(auth.context.tenantId, {
      from,
      to,
      vendorId: params.get("vendor_id"),
      campaignId: params.get("campaign_id"),
      productCode: params.get("product_code"),
      persistDays: persist ? Number(persist) : null,
    }, params.get("grain") === "month" ? "month" : "week");
    return NextResponse.json(series, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the series" }, { status: 400 });
  }
}
