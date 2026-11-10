import { NextResponse, type NextRequest } from "next/server";

import { invoicePdf, PayoutError } from "@/lib/accounting/payoutStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Partner payouts rework (owner, 2026-11-06) · the invoice as a PDF: the copy stored when it was
 * published, or drawn now for a draft. Owner and bookkeeper.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("payout_runs", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { bytes, filename } = await invoicePdf(auth.context.tenantId, id);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[payouts-invoice]", error);
    return NextResponse.json({ error: "The invoice could not be drawn" }, { status: 500 });
  }
}
