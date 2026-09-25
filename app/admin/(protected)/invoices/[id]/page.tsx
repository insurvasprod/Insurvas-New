import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canVoidInvoices, canViewInvoices } from "@/lib/invoices/permissions";
import { InvoiceDetailView } from "@/components/admin/invoice-detail-view";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // SA-3.3: a support_agent cannot open invoice screens at all.
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const { id } = await params;
  return <InvoiceDetailView id={id} canAct={canVoidInvoices(admin.role)} />;
}
