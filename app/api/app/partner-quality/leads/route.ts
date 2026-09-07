import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listPartnerQualityLeads } from "@/lib/partnerQuality/service";

function errorResponse(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load partner quality leads" }, { status: 400 }); }

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("partner_quality", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  try { return NextResponse.json(await listPartnerQualityLeads(auth.context.tenantId, { from: params.get("from"), to: params.get("to"), partnerId: params.get("partner_id"), metric: params.get("metric"), disposition: params.get("disposition"), page: params.get("page"), pageSize: params.get("page_size") }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
