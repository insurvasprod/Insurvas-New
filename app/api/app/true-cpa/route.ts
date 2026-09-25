import { NextResponse, type NextRequest } from "next/server";

import { getVendorScorecard, scorecardCsv } from "@/lib/vendorScorecard/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const params = request.nextUrl.searchParams;
    const report = await getVendorScorecard(auth.context.tenantId, { from: params.get("from"), to: params.get("to"), vendorId: params.get("vendor_id"), campaignId: params.get("campaign_id"), productCode: params.get("product_code"), persistDays: params.get("persist_days") }, auth.entitlement.access === "read_only");
    if (params.get("format") === "csv") return new NextResponse(scorecardCsv(report.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=vendor-scorecard.csv", "Cache-Control": "no-store" } });
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load vendor scorecard" }, { status: 400 });
  }
}
