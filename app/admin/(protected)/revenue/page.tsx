import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { revenuePeriod } from "@/lib/revenue/present";
import { RevenueView } from "@/components/admin/revenue-view";

/** Revenue (admin round 1, billing-r2 screen 11): `?period=30|90|12m`, 30 days when absent. */
export default async function RevenuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const { period } = await searchParams;
  return <RevenueView periodKey={revenuePeriod(period).key} />;
}
