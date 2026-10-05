import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { createManualDeal, dealFlowCsvHeader, dealFlowCsvLines, dealFlowExportPages, listDealFlow } from "@/lib/dealFlow/service";

function queryParams(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const number = (key: string, fallback: number) => { const value = Number(params.get(key)); return Number.isInteger(value) && value > 0 ? value : fallback; };
  const focusLeadId = params.get("focus_lead_id") ?? undefined;
  // With a focus and no explicit page, the report returns the page that holds the focused deal.
  const page = params.has("page") ? number("page", 1) : focusLeadId ? null : 1;
  return { fromDate: params.get("from") ?? undefined, toDate: params.get("to") ?? undefined, partnerId: params.get("partner_id") ?? undefined, productLine: params.get("product_line") ?? undefined, agentId: params.get("agent_id") ?? undefined, status: params.get("status") ?? undefined, stageType: params.get("stage_type") ?? undefined, search: params.get("search") ?? undefined, focusLeadId, page, pageSize: Math.min(10000, number("page_size", 100)) };
}

function errorResponse(error: unknown, fallback: string) { return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 }); }

/**
 * LA-1.13-10: the CSV streams page by page (dealFlowExportPages, 1,000 deals a read) instead of
 * one 10,000-row read that hit the statement timeout. The first page is read before the response
 * starts, so a bad filter or a failed first read is still a 400. A later failure aborts the
 * download rather than ending it early, so a cut-short file never looks complete.
 */
async function csvResponse(tenantId: string, filters: ReturnType<typeof queryParams>) {
  const pages = dealFlowExportPages(tenantId, { ...filters, focusLeadId: undefined, page: 1 });
  const first = await pages.next();
  const encoder = new TextEncoder();
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(dealFlowCsvHeader() + (first.done ? "" : dealFlowCsvLines(first.value))));
        if (first.done) controller.close();
        return;
      }
      try {
        const next = await pages.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(dealFlowCsvLines(next.value)));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await pages.return(undefined);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=deal-flow.csv", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const filters = queryParams(request);
    if (request.nextUrl.searchParams.get("format") === "csv") return await csvResponse(auth.context.tenantId, filters);
    const result = await listDealFlow(auth.context.tenantId, filters);
    return NextResponse.json({ ...result, readOnly: auth.entitlement.access === "read_only" });
  } catch (error) { return errorResponse(error, "Could not load daily deal flow"); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  try {
    const deal = await createManualDeal(auth.context.tenantId, auth.context.userId, body ?? {});
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.deal_flow_created", targetType: "deal_flow", targetId: deal.id, metadata: { manualEntry: true }, request });
    return NextResponse.json({ deal }, { status: 201 });
  } catch (error) { return errorResponse(error, "Could not create manual deal"); }
}
