import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listPartnerQuality } from "@/lib/partnerQuality/service";

function errorResponse(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load partner quality" }, { status: 400 }); }

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("partner_quality", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json(await listPartnerQuality(auth.context.tenantId, { from: request.nextUrl.searchParams.get("from"), to: request.nextUrl.searchParams.get("to") }, auth.entitlement.access === "read_only"), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
