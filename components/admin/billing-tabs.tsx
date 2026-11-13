"use client";

import { usePathname } from "next/navigation";

import { ViewTabs } from "@/components/ui/view-tabs";

const TABS = [
  { key: "/admin/billing", label: "Overview" },
  { key: "/admin/invoices", label: "Invoices" },
  { key: "/admin/coupons", label: "Coupons" },
  { key: "/admin/credit-notes", label: "Refunds & credits" },
  { key: "/admin/revenue", label: "Revenue" },
] as const;

type BillingTab = (typeof TABS)[number]["key"];

/**
 * The billing workspace's sub-pages: the shared sub-page bar (UI-CONSISTENCY §8b), passed as the page header's `tabs`
 * so it sits on the title's line. Each tab is its own address; an invoice's own pages count as Invoices.
 */
export function BillingTabs() {
  const pathname = usePathname() ?? "";
  const value: BillingTab = TABS.find((tab) => pathname === tab.key || (tab.key === "/admin/invoices" && pathname.startsWith("/admin/invoices/")))?.key ?? "/admin/billing";
  return <ViewTabs label="Billing workspace" value={value} tabs={TABS.map((tab) => ({ ...tab, href: tab.key }))} />;
}
