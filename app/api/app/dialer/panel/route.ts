import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getDialerPanel } from "@/lib/dialerScripts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES);
  if (auth instanceof NextResponse) return auth;
  const leadId = request.nextUrl.searchParams.get("lead_id");
  if (!z.string().uuid().safeParse(leadId).success) return NextResponse.json({ error: "Choose a valid lead" }, { status: 400 });
  try {
    // Cost per lead is money: owners and producers see it, a setter does not (user decision 2026-09-25).
    const includeCost = auth.context.role === "owner" || auth.context.role === "producer";
    return NextResponse.json(await getDialerPanel({ tenantId: auth.context.tenantId, agentId: auth.context.userId, leadId: leadId as string, campaignId: request.nextUrl.searchParams.get("campaign_id"), productCode: request.nextUrl.searchParams.get("product_code"), includeCost }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load dialer guidance" }, { status: 400 });
  }
}
