import { NextResponse } from "next/server";

import { getVendorReturnsPage } from "@/lib/vendorScorecard/returnsService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Vendor returns: every claim, what is claimable per campaign (claimable and expired dollars, window,
 * first import — vendor_returns_candidates_summary) and the undialable share per vendor.
 */
export async function GET() {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getVendorReturnsPage(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load vendor returns" }, { status: 400 });
  }
}
