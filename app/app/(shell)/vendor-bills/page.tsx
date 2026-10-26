import { guardPage } from "@/lib/entitlements/guardPage";
import { VendorBillsPage } from "@/components/app/lead-sources/pages";

/**
 * Vendor bills (2026-10-26): Lead invoices and Vendor returns as one page. `?tab=returns`,
 * `?open=<invoice>`, `?vendor=<id>`. Each tab keeps its old page's plan and role gate (VendorBillsPage).
 */
export default async function VendorBills({ searchParams }: { searchParams: Promise<{ tab?: string; open?: string; vendor?: string | string[] }> }) {
  const [money, returns] = await Promise.all([guardPage("profit_and_loss"), guardPage("true_cpa")]);
  const { tab, open, vendor } = await searchParams;
  return <VendorBillsPage tab={tab === "returns" ? "returns" : "invoices"} open={open} vendor={typeof vendor === "string" ? vendor : undefined} guards={{ money, returns }} />;
}
