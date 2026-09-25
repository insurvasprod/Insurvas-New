import { NextResponse, type NextRequest } from "next/server";

import {
  ClaimNeedsDatabaseUpdateError,
  ClaimRefusedError,
  claimableRowsCsv,
  createImportRemovalClaim,
  isRemovalReason,
} from "@/lib/leadLists/detail";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The rows the scrub removed from one list at import, as the vendor will want them: phone, reason
 * and the line of their own file. Same feature and roles as the rest of Vendor returns — it is the
 * evidence half of a claim, and it carries what each row cost.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  const campaignId = params.get("campaign_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ error: "Choose a list" }, { status: 400 });
  const reason = params.get("reason");
  if (reason && !isRemovalReason(reason)) return NextResponse.json({ error: "Unknown removal reason" }, { status: 400 });
  try {
    const csv = await claimableRowsCsv(auth.context.tenantId, campaignId, reason && isRemovalReason(reason) ? reason : undefined);
    if (csv == null) return NextResponse.json({ error: "That list does not exist" }, { status: 404 });
    const name = `claimable-${campaignId.slice(0, 8)}${reason ? `-${reason}` : ""}.csv`;
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=${name}`, "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not export the claimable rows" }, { status: 400 });
  }
}

/**
 * Drafts one claim in the Vendor returns ledger from the list's creditable import removals that are
 * on no claim and inside the vendor's return window (20260925703200). Same feature and roles as
 * creating any other claim (../claims/route.ts); the SQL function writes the audit row.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { campaign_id?: unknown; reason?: unknown } | null;
  const campaignId = typeof body?.campaign_id === "string" ? body.campaign_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ error: "Choose a list" }, { status: 400 });
  const reason = body?.reason ?? null;
  if (reason !== null && !isRemovalReason(reason)) return NextResponse.json({ error: "Unknown removal reason" }, { status: 400 });
  try {
    const claim = await createImportRemovalClaim(auth.context.tenantId, campaignId, auth.context.userId, reason ?? undefined);
    return NextResponse.json({ id: claim.claimId, rows: claim.rows, amount_claimed_cents: claim.amountClaimedCents }, { status: 201 });
  } catch (error) {
    if (error instanceof ClaimNeedsDatabaseUpdateError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof ClaimRefusedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not draft the claim" }, { status: 400 });
  }
}
