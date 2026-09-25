import { NextResponse, type NextRequest } from "next/server";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { loadDialFunnel } from "@/lib/dealFlow/dialFunnelLoader";
import { assertUuid, date } from "@/lib/dealFlow/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** The DealFlow day funnel for a range of the agency's local dates. Read-only. */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("daily_deal_flow", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  try {
    const fromDate = date(params.get("from"), "From date");
    const toDate = date(params.get("to"), "To date");
    if (fromDate > toDate) throw new Error("The From date must be on or before the To date");
    const agentParam = params.get("agent_id");
    const agentId = agentParam ? assertUuid(agentParam, "agent") : undefined;
    const timeZone = await getWorkspaceTimezone(auth.context.tenantId).catch(() => null);
    const funnel = await loadDialFunnel(auth.context.tenantId, { fromDate, toDate, agentId, timeZone });
    return NextResponse.json(funnel, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the day funnel" }, { status: 400 });
  }
}
