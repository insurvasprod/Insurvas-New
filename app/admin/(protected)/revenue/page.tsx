import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { RevenueView } from "@/components/admin/revenue-view";

export default async function RevenuePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  return <RevenueView />;
}
