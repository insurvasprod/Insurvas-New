import { NextResponse, type NextRequest } from "next/server";

import { getVendorScorecardLeads } from "@/lib/vendorScorecard/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The rows behind a scorecard figure: ?stage=received|dialable|undialable|dialed|contacted|quoted|
 * applied|issued, scoped by vendor_id / campaign_id / product_code (or none, for every campaign),
 * or ?attempt_number= / ?slot= for the curves. Paged with offset and limit, and the response says
 * the total and whether there is more (LA-2.17-7).
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(
      await getVendorScorecardLeads(auth.context.tenantId, {
        from: params.get("from"),
        to: params.get("to"),
        vendorId: params.get("vendor_id"),
        campaignId: params.get("campaign_id"),
        productCode: params.get("product_code"),
        stage: params.get("stage"),
        attemptNumber: params.get("attempt_number"),
        slot: params.get("slot"),
        persistDays: params.get("persist_days"),
        offset: params.get("offset"),
        limit: params.get("limit"),
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load scorecard leads";
    return NextResponse.json({ error: message }, { status: /database update that has not been applied/.test(message) ? 503 : 400 });
  }
}
