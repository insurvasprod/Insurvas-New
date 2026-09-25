import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { InvoicePrintView } from "@/components/admin/invoice-print-view";

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const { id } = await params;
  return <InvoicePrintView id={id} />;
}
