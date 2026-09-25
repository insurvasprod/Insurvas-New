import { NextResponse, type NextRequest } from "next/server";

import { getVendorReturnClaimDetail, updateVendorReturnClaim, vendorReturnCsv } from "@/lib/vendorScorecard/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const detail = await getVendorReturnClaimDetail(auth.context.tenantId, id);
    if (request.nextUrl.searchParams.get("format") === "csv") return new NextResponse(vendorReturnCsv(detail), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=vendor-return-${id}.csv`, "Cache-Control": "no-store" } });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load claim evidence" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const auth = await requireFeatureRole("true_cpa", ["owner", "producer", "bookkeeper"], { write: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action !== "submit" && body?.action !== "resolve") throw new Error("Choose submit or resolve");
    const amount = body?.amount_credited_cents == null ? 0 : Number(body.amount_credited_cents);
    const replacements = body?.replacement_leads_count == null ? 0 : Number(body.replacement_leads_count);
    if (!Number.isInteger(amount) || amount < 0 || !Number.isInteger(replacements) || replacements < 0) throw new Error("Claim amounts must be whole non-negative cents");
    const claim = await updateVendorReturnClaim(auth.context.tenantId, id, { action: body.action, status: typeof body.status === "string" ? body.status : undefined, amountCreditedCents: amount, replacementLeadsCount: replacements, rejectionReason: typeof body.rejection_reason === "string" ? body.rejection_reason : undefined, notes: typeof body.notes === "string" ? body.notes : undefined });
    return NextResponse.json({ claim });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update vendor return claim" }, { status: 400 });
  }
}
