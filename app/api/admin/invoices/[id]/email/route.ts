import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { fetchInvoiceDetail } from "@/lib/invoices/queries";
import { sendInvoiceEmail } from "@/lib/invoices/emailInvoice";
import { audit } from "@/lib/audit/log";

/**
 * POST /api/admin/invoices/[id]/email — email the invoice to the customer's owner (billing-r2 screen 5,
 * "Email to customer"). The same people who may act on an invoice (CAN_VOID_INVOICES: billing admins and super
 * admins). Takes no body: the recipient and the wording are the invoice's own, previewed in the sheet first.
 *
 * Every attempt is audited and recorded in email_log, including one email delivery was off for, so the
 * sheet's "Emails sent" tab and the audit log say what actually happened rather than what was asked for.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const detail = await fetchInvoiceDetail(id);
  if (!detail) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const { draft, delivery } = await sendInvoiceEmail(detail);
  if (!draft.ok || !delivery) return NextResponse.json({ error: draft.ok ? "Could not send the invoice" : draft.reason }, { status: 409 });

  await audit({
    actorId: auth.session.sub,
    action: "invoice.emailed",
    targetType: "invoice",
    targetId: id,
    metadata: { number: detail.invoice.number, tenantId: detail.invoice.tenant_id, to: draft.to, delivered: delivery.delivered, reason: delivery.delivered ? null : delivery.reason },
    request,
  });

  if (delivery.delivered) return NextResponse.json({ delivered: true, message: `${detail.invoice.number} emailed to ${draft.to}` });
  const why = delivery.reason === "email_delivery_disabled"
    ? "email delivery is off here"
    : delivery.reason === "reserved_test_recipient" ? "the address is a test address" : delivery.reason === "email_not_configured" ? "email is not set up" : "the mail server refused it";
  return NextResponse.json({ delivered: false, message: `Recorded, not sent: ${why}.` }, { status: 200 });
}
