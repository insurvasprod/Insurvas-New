import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_INVOICES } from "@/lib/invoices/permissions";
import { fetchInvoices } from "@/lib/invoices/queries";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/invoices/constants";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");

  const invoices = await fetchInvoices({
    status: status && (INVOICE_STATUSES as readonly string[]).includes(status)
      ? (status as InvoiceStatus)
      : "all",
    tenantId: params.get("tenant") ?? undefined,
    overdueOnly: params.get("overdue") === "true",
    mismatchedOnly: params.get("mismatched") === "true",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });

  return NextResponse.json({ invoices });
}
