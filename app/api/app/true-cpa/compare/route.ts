import { NextResponse, type NextRequest } from "next/server";

import { comparisonCadenceCaveat } from "@/lib/cadence/historyService";
import { getCampaignComparison } from "@/lib/vendorScorecard/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const p = request.nextUrl.searchParams;
    const comparison = await getCampaignComparison(auth.context.tenantId, { campaignAId: p.get("campaign_a_id"), campaignBId: p.get("campaign_b_id"), fromA: p.get("from_a"), toA: p.get("to_a"), fromB: p.get("from_b"), toB: p.get("to_b"), metric: p.get("metric") });
    // The board's caveat: two campaigns that ran different cadences are two things compared at once.
    // A failure to read the history is not a failed comparison — the numbers stand, and the caveat
    // says it could not be checked rather than implying the cadences matched.
    const { campaign_a: a, campaign_b: b } = comparison;
    const cadence = await (a && b
      ? comparisonCadenceCaveat(
          auth.context.tenantId,
          { campaignId: a.id, name: a.name, from: a.from, to: a.to },
          { campaignId: b.id, name: b.name, from: b.from, to: b.to },
        )
      : Promise.reject(new Error("the comparison named no campaigns"))
    ).catch((error: unknown) => ({
      status: "unknown" as const,
      message: `Whether the two periods ran the same cadence could not be checked: ${error instanceof Error ? error.message : "the cadence history did not load"}.`,
      historySince: null,
      a: null,
      b: null,
    }));
    return NextResponse.json({ ...comparison, cadence }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not compare campaigns" }, { status: 400 });
  }
}
