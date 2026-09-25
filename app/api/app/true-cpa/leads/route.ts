import { NextResponse, type NextRequest } from "next/server";

import { getVendorScorecardLeads } from "@/lib/vendorScorecard/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(await getVendorScorecardLeads(auth.context.tenantId, { from: params.get("from"), to: params.get("to"), vendorId: params.get("vendor_id"), campaignId: params.get("campaign_id"), productCode: params.get("product_code") }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load scorecard leads" }, { status: 400 });
  }
}
