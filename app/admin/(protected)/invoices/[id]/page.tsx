import { notFound, redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canVoidInvoices, canViewInvoices } from "@/lib/invoices/permissions";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { InvoiceDetailView, invoiceTitle, loadInvoiceView } from "@/components/admin/invoice-detail-view";

/**
 * An invoice's own page, kept so every link to /admin/invoices/[id] still works (billing-r2: the list opens it
 * as a sheet). The same view as the sheet, inside the Billing frame on the Invoices step, titled "INV-… · Customer".
 */
export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // SA-3.3: a support_agent cannot open invoice screens at all.
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const { id } = await params;
  const view = await loadInvoiceView(id);
  if (!view) notFound();
  return (
    <BillingPage step="invoices" title={invoiceTitle(view)} info="One invoice: what we billed, what the provider charged, and what was done about it.">
      <InvoiceDetailView view={view} canAct={canVoidInvoices(admin.role)} />
    </BillingPage>
  );
}
