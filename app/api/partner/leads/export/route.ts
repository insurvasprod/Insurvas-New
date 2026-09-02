import { NextResponse, type NextRequest } from "next/server";

import { listPartnerLeads, partnerLeadsCsv } from "@/lib/partnerLeads/service";
import type { PartnerLeadFilters } from "@/lib/partnerLeads/types";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

function filters(request: NextRequest): PartnerLeadFilters {
  const params = request.nextUrl.searchParams;
  return { dateFrom: params.get("date_from") || undefined, dateTo: params.get("date_to") || undefined, closerId: params.get("closer_id") || undefined, product: params.get("product") || undefined, stageId: params.get("stage_id") || undefined, outcome: params.get("outcome") || undefined };
}

export async function GET(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const requested = request.nextUrl.searchParams.get("partner_id");
  if (requested && requested !== auth.context.partnerId) return NextResponse.json({ error: "You cannot export another partner's leads" }, { status: 403 });
  try {
    const result = await listPartnerLeads(auth.context.tenantId, auth.context.partnerId, filters(request), auth.context.partnerTimezone);
    return new NextResponse(partnerLeadsCsv(result.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=partner-leads.csv", "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not export partner leads" }, { status: 400 }); }
}
