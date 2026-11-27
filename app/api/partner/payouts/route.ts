import { NextResponse } from "next/server";

import { partnerRuns, PayoutError } from "@/lib/accounting/payoutStore";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { partnerPayoutFacts } from "@/lib/partnerLeads/phoneFacts";

/**
 * LA-7.4 (Notion sprint) · the partner's own payout statements, published or paid — never a draft,
 * never another partner's. Scoped on the server to the session's tenant and partner. Partner admins
 * only: what the organisation is paid is not for every seat.
 */
export async function GET(request: Request) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  try {
    const params = new URL(request.url).searchParams;
    const limit = params.get("limit") === "1" ? 1 : undefined;
    const runs = await partnerRuns(context.tenantId, context.partnerId, limit);
    // The phone app (board K1, K4) asks with phone=1 for the payout facts: the next statement's
    // expected pay date by the agency's own timer, its per-unit lines, and how the agency pays.
    if (params.get("phone") === "1") return NextResponse.json({ runs, payout: await partnerPayoutFacts(context.tenantId, context.partnerId, runs) }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ runs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.status === 503 ? "Statements are not available yet." : error.message }, { status: error.status });
    console.error("[partner-payouts]", error);
    return NextResponse.json({ error: "Statements could not be loaded" }, { status: 500 });
  }
}
