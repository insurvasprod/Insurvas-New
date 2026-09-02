import { NextResponse, type NextRequest } from "next/server";

import { listPartnerLeads } from "@/lib/partnerLeads/service";
import type { PartnerLeadFilters } from "@/lib/partnerLeads/types";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

function filters(request: NextRequest): PartnerLeadFilters {
  const params = request.nextUrl.searchParams;
  return { dateFrom: params.get("date_from") || undefined, dateTo: params.get("date_to") || undefined, closerId: params.get("closer_id") || undefined, product: params.get("product") || undefined, stageId: params.get("stage_id") || undefined, outcome: params.get("outcome") || undefined };
}

function checkPartnerParam(request: NextRequest, partnerId: string) {
  const requested = request.nextUrl.searchParams.get("partner_id");
  return !requested || requested === partnerId;
}

export async function GET(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (!checkPartnerParam(request, auth.context.partnerId)) return NextResponse.json({ error: "You cannot access another partner pipeline" }, { status: 403 });
  try { return NextResponse.json(await listPartnerLeads(auth.context.tenantId, auth.context.partnerId, filters(request), auth.context.partnerTimezone), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load partner pipeline" }, { status: 400 }); }
}

export async function HEAD(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (!checkPartnerParam(request, auth.context.partnerId)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 200 });
}
