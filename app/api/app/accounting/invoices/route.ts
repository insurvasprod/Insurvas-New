import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { fromTemplateSchema, invoiceFail, invoiceSchema, toInput } from "@/lib/accounting/invoiceSchemas";
import { createInvoice, invoiceFromTemplate, invoiceSources, listInvoices, listTemplates, tolerance } from "@/lib/accounting/invoiceStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.2 (Notion sprint) · vendor invoices: the list, and entering one — in full, or from a
 * recurring template in three fields. Owner and bookkeeper only: this is what the agency pays.
 */
const ROLES = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  const status = request.nextUrl.searchParams.get("status");
  try {
    const [invoices, sources, templates, tol] = await Promise.all([
      listInvoices(tenantId, { status: status === "open" || ["draft", "received", "approved", "paid", "disputed", "void"].includes(status ?? "") ? (status as "open") : undefined }),
      invoiceSources(tenantId),
      listTemplates(tenantId),
      tolerance(tenantId),
    ]);
    return NextResponse.json({ invoices, sources, templates, toleranceCents: tol }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invoiceFail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;
  const json = await request.json().catch(() => null);
  try {
    let id: string;
    const t = fromTemplateSchema.safeParse(json);
    if (t.success) {
      id = await invoiceFromTemplate(tenantId, userId, t.data.template_id, { invoiceNumber: t.data.invoice_number, invoiceDate: t.data.invoice_date, quantities: t.data.quantities });
    } else {
      const parsed = invoiceSchema.safeParse(json);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the invoice and try again." }, { status: 400 });
      id = await createInvoice(tenantId, userId, toInput(parsed.data));
    }
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_saved", targetType: "vendor_invoice", targetId: id, metadata: { tenantId, fromTemplate: t.success }, request });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return invoiceFail(error);
  }
}
