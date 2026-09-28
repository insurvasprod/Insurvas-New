import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getPartnerQualityDetail, PartnerQualityNotFoundError } from "@/lib/partnerQuality/detail";

// One partner's quality figures for a period (the /app/partner-quality/[partnerId] page). Same
// feature and roles as the list report; the partner must belong to the caller's tenant. No cost data.
export async function GET(request: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const auth = await requireFeatureRole("partner_quality", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  const { partnerId } = await params;
  const search = request.nextUrl.searchParams;
  try {
    return NextResponse.json(await getPartnerQualityDetail(auth.context.tenantId, partnerId, { from: search.get("from"), to: search.get("to") }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof PartnerQualityNotFoundError ? 404 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load this partner" }, { status });
  }
}
