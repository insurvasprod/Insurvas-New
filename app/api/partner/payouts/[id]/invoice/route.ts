import { NextResponse, type NextRequest } from "next/server";

import { partnerInvoicePdf, PayoutError } from "@/lib/accounting/payoutStore";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

/**
 * Partner payouts rework (owner, 2026-11-06) · the partner's own invoice as a PDF, published or paid
 * only; another partner's, or a draft, is "Not found". Partner admins only.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { bytes, filename } = await partnerInvoicePdf(auth.context.tenantId, auth.context.partnerId, id);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayoutError) return NextResponse.json({ error: error.status === 503 ? "Invoices are not available yet." : error.message }, { status: error.status });
    console.error("[partner-invoice]", error);
    return NextResponse.json({ error: "The invoice could not be opened" }, { status: 500 });
  }
}
