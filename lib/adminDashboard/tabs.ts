// The admin dashboard's tabs (admin round 1, owner 2026-11-17: "the first one all graphs, then all sub pages of
// everything an admin needs to see"; docs/design/admin-r1/dashboard-combined.html). Plain module so which role
// gets which tab is testable. A tab is offered only when the role can open the pages it reports on: the same
// can-open answer the rail gives (canOpenAdminHref), never a list of its own.

import type { AdminRole } from "../adminAuth/roles.ts";
import { canOpenAdminHref } from "./compose.ts";

export const ADMIN_DASHBOARD_TABS = ["overview", "needs", "money", "customers", "health", "security"] as const;
export type AdminDashboardTab = (typeof ADMIN_DASHBOARD_TABS)[number];

export const ADMIN_DASHBOARD_TAB_LABELS: Record<AdminDashboardTab, string> = {
  overview: "Overview",
  needs: "Needs you",
  money: "Money",
  customers: "Customers",
  health: "Platform health",
  security: "Security & staff",
};

/** The tabs this role gets, in order. Overview and Needs you are everyone's; the rest follow the rail. */
export function dashboardTabsFor(role: AdminRole): AdminDashboardTab[] {
  return ADMIN_DASHBOARD_TABS.filter((tab) => {
    if (tab === "money") return canOpenAdminHref(role, "/admin/revenue") || canOpenAdminHref(role, "/admin/invoices");
    if (tab === "customers") return canOpenAdminHref(role, "/admin/tenants");
    if (tab === "security") return canOpenAdminHref(role, "/admin/audit-log");
    return true;
  });
}

/** The tab in the address when the role has it, else Overview. */
export function pickDashboardTab(role: AdminRole, asked: string | undefined | null): AdminDashboardTab {
  const tabs = dashboardTabsFor(role);
  return tabs.find((tab) => tab === asked) ?? "overview";
}

/** The tab's address: Overview is the bare /admin. */
export function dashboardTabHref(tab: AdminDashboardTab): string {
  return tab === "overview" ? "/admin" : `/admin?tab=${tab}`;
}
