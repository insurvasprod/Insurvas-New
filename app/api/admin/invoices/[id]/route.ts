import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_INVOICES } from "@/lib/invoices/permissions";
import { fetchInvoiceDetail } from "@/lib/invoices/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VIEW_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const detail = await fetchInvoiceDetail(id);
  if (!detail) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  return NextResponse.json(detail);
}
