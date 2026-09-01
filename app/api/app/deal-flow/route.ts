import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { createManualDeal, csvForDealFlow, listDealFlow } from "@/lib/dealFlow/service";

function queryParams(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const number = (key: string, fallback: number) => { const value = Number(params.get(key)); return Number.isInteger(value) && value > 0 ? value : fallback; };
  return { fromDate: params.get("from") ?? undefined, toDate: params.get("to") ?? undefined, partnerId: params.get("partner_id") ?? undefined, productLine: params.get("product_line") ?? undefined, agentId: params.get("agent_id") ?? undefined, status: params.get("status") ?? undefined, page: number("page", 1), pageSize: Math.min(10000, number("page_size", 100)) };
}

function errorResponse(error: unknown, fallback: string) { return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 }); }

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const filters = queryParams(request);
    const isCsv = request.nextUrl.searchParams.get("format") === "csv";
    const result = await listDealFlow(auth.context.tenantId, isCsv ? { ...filters, page: 1, pageSize: 10000 } : filters);
    if (isCsv) return new NextResponse(csvForDealFlow(result.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=deal-flow.csv", "Cache-Control": "no-store" } });
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
