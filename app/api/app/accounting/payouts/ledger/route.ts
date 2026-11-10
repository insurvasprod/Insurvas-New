import { NextResponse, type NextRequest } from "next/server";

import { listLedger, PayoutError } from "@/lib/accounting/payoutStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Partner payouts rework (owner, 2026-11-06) · the partner ledger: every entry each partner earned, its
 * client, its invoice and — while unpaid — when it is expected to be invoiced. Reading it first brings
 * the ledger up to date (idempotent). Owner and bookkeeper.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("payout_runs", ROLES);
  if (auth instanceof NextResponse) return auth;
  const partner = request.nextUrl.searchParams.get("partner");
  try {
    return NextResponse.json(await listLedger(auth.context.tenantId, { partnerId: partner && UUID.test(partner) ? partner : null }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[payouts-ledger]", error);
    return NextResponse.json({ error: "The ledger could not be loaded" }, { status: 500 });
  }
}
