import type { TenantRole } from "../tenantAuth/roles.ts";
import { firstOpenable } from "./roleHome.ts";

/**
 * The dashboard's views (owner 2026-11-06, canvas "Dashboards · by role", round 3): Overview, then one view
 * per module the agency's plan has and this person's role may open. A view is offered when any page of its
 * module is open to the reader (`firstOpenable`, the menu's own rule), so a view never shows figures from a
 * page its reader cannot open. The choice lives in the address (`?view=`), so a shared link keeps it.
 */
export const DASHBOARD_VIEWS = [
  { key: "overview", label: "Overview", opens: [] },
  { key: "leads", label: "Leads", opens: ["leads.lists", "leads.workspace", "leads.dialer"] },
  { key: "retention", label: "Retention", opens: ["retention.save-queue", "retention.lapse-risk", "retention.payment-repair"] },
  { key: "book", label: "Book of business", opens: ["book.policies", "book.carrier_files", "book.needs_you"] },
  { key: "accounting", label: "Accounting", opens: ["accounting.pnl", "accounting.bank", "accounting.invoices"] },
  { key: "compliance", label: "Compliance", opens: ["compliance.dashboard", "compliance.complaints", "compliance.tcpa", "compliance.consent"] },
] as const;

export type DashboardViewKey = (typeof DASHBOARD_VIEWS)[number]["key"];

export function isDashboardView(value: unknown): value is DashboardViewKey {
  return typeof value === "string" && DASHBOARD_VIEWS.some((view) => view.key === value);
}

/** The views this reader gets, in order. Overview always; a module view only with an open page behind it. */
export function dashboardViews(granted: Iterable<string>, role: TenantRole, solo = false): Array<{ key: DashboardViewKey; label: string; href: string }> {
  const features = [...granted];
  return DASHBOARD_VIEWS.filter((view) => view.key === "overview" || firstOpenable(view.opens, features, role, solo) !== null).map((view) => ({
    key: view.key,
    label: view.label,
    href: view.key === "overview" ? "/app/dashboard" : `/app/dashboard?view=${view.key}`,
  }));
}

/** The view to draw: the one asked for when this reader has it, else Overview. */
export function pickDashboardView(asked: unknown, offered: ReadonlyArray<{ key: DashboardViewKey }>): DashboardViewKey {
  return isDashboardView(asked) && offered.some((view) => view.key === asked) ? asked : "overview";
}
