import { NextResponse, type NextRequest } from "next/server";

import { ReturnsRequestError, createCombinedVendorReturnClaim, parseClaimReasons } from "@/lib/vendorScorecard/returnsService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Drafts ONE claim for a campaign from its claimable rows — scrub hits and wrong-number or
 * disconnected calls on its leads, and the rows the scrub removed at import — optionally only the
 * reasons left on in the preview (`reasons`, omitted or null = all). The SQL function writes the
 * audit row (tenant.vendor_claim_drafted).
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"], { write: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => null) as { campaign_id?: unknown; reasons?: unknown } | null;
    const reasons = parseClaimReasons(body?.reasons ?? null);
    const claim = await createCombinedVendorReturnClaim(auth.context.tenantId, body?.campaign_id, auth.context.userId, reasons);
    return NextResponse.json({ id: claim.claimId, rows: claim.rows, amount_claimed_cents: claim.amountClaimedCents, lead_rows: claim.leadRows, removal_rows: claim.removalRows }, { status: 201 });
  } catch (error) {
    if (error instanceof ReturnsRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create vendor return claim" }, { status: 400 });
  }
}
