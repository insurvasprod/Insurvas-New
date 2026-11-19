import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { InvoicePrintView } from "@/components/admin/invoice-print-view";

/** The printable invoice, its own page. `?pdf=1` (the sheet's Download PDF) opens the save-as-PDF dialog at once. */
export default async function InvoicePrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <InvoicePrintView id={id} autoPrint={query.pdf === "1"} />;
}
