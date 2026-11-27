import { NextResponse, type NextRequest } from "next/server";

import { listPartnerLeads } from "@/lib/partnerLeads/service";
import type { PartnerLeadFilters } from "@/lib/partnerLeads/types";
import { partnerTeamMembers, requirePartner } from "@/lib/partnerAuth/requirePartner";
import { visibleSubmitters } from "@/lib/partnerAuth/team";
import { pipelineLiveFacts } from "@/lib/partnerLeads/phoneFacts";

function filters(request: NextRequest): PartnerLeadFilters {
  const params = request.nextUrl.searchParams;
  return { dateFrom: params.get("date_from") || undefined, dateTo: params.get("date_to") || undefined, closerId: params.get("closer_id") || undefined, product: params.get("product") || undefined, stageId: params.get("stage_id") || undefined, outcome: params.get("outcome") || undefined, pipelineId: params.get("pipeline_id") || undefined };
}

function checkPartnerParam(request: NextRequest, partnerId: string) {
  const requested = request.nextUrl.searchParams.get("partner_id");
  return !requested || requested === partnerId;
}

export async function GET(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (!checkPartnerParam(request, auth.context.partnerId)) return NextResponse.json({ error: "You cannot access another partner pipeline" }, { status: 403 });
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "250");
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  try {
    const members = await partnerTeamMembers(auth.context.tenantId, auth.context.partnerId);
    const visibleSubmitterIds = visibleSubmitters({ userId: auth.context.userId, role: auth.context.role }, members);
    const page = await listPartnerLeads(auth.context.tenantId, auth.context.partnerId, filters(request), auth.context.partnerTimezone, { limit, offset }, { userId: auth.context.userId, role: auth.context.role, visibleSubmitterIds });
    // The phone app (board K1, K3) asks with live=1 for each row's live line: the claimer's first name,
    // when it was claimed and the next callback, read only for the work items this scoped page returned.
    if (request.nextUrl.searchParams.get("live") === "1") {
      const live = await pipelineLiveFacts(auth.context.tenantId, auth.context.partnerId, page.rows.map((row) => row.workItemId));
      return NextResponse.json({ ...page, rows: page.rows.map((row) => (live[row.workItemId] ? { ...row, live: live[row.workItemId] } : row)) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load partner pipeline" }, { status: 400 }); }
}

export async function HEAD(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (!checkPartnerParam(request, auth.context.partnerId)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 200 });
}
