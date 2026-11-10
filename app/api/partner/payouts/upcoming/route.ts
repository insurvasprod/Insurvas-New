import { NextResponse } from "next/server";

import { partnerTracker, PayoutError } from "@/lib/accounting/payoutStore";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

/**
 * Partner payouts rework (owner, 2026-11-06) · "Coming up": every client this partner sent, where it
 * stands (transferred, application submitted, issued, charged back), what it has earned and when payment
 * can be expected. Scoped on the server to the session's tenant and partner. Partner admins only.
 */
export async function GET() {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ clients: await partnerTracker(auth.context.tenantId, auth.context.partnerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.status === 503 ? "This view is not available yet." : error.message }, { status: error.status });
    console.error("[partner-upcoming]", error);
    return NextResponse.json({ error: "Your clients could not be loaded" }, { status: 500 });
  }
}
