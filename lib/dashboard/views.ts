import type { TenantRole } from "../tenantAuth/roles.ts";
import { firstOpenable, type MenuGate } from "./roleHome.ts";

/**
 * The dashboard's views (owner 2026-11-06, canvas "Dashboards · by role", round 3): Overview, then one view
 * per module the agency's plan has and this person's role may open. A view is offered when any page of its
 * module is open to the reader (`firstOpenable`, the menu's own rule), so a view never shows figures from a
 * page its reader cannot open. The choice lives in the address (`?view=`), so a shared link keeps it.
 */
export const DASHBOARD_VIEWS = [
  // Roles r1 (owner 2026-11-18): the first view is the role's compact Home, named as the board names it.
  { key: "overview", label: "Home", opens: [], wideOnly: false },
  { key: "leads", label: "Leads", opens: ["leads.lists", "leads.workspace", "leads.dialer"], wideOnly: false },
  { key: "retention", label: "Retention", opens: ["retention.save-queue", "retention.lapse-risk", "retention.payment-repair"], wideOnly: false },
  { key: "book", label: "Book", opens: ["book.policies", "book.carrier_files", "book.needs_you"], wideOnly: false },
  // The agency's books are agency-wide: its loader reads nothing for a session narrowed to a producer scope, so the
  // view would draw empty (`wideOnly`).
  { key: "accounting", label: "Accounting", opens: ["accounting.pnl", "accounting.bank", "accounting.invoices"], wideOnly: true },
  { key: "compliance", label: "Compliance", opens: ["compliance.dashboard", "compliance.complaints", "compliance.tcpa", "compliance.consent"], wideOnly: false },
] as const;

export type DashboardViewKey = (typeof DASHBOARD_VIEWS)[number]["key"];

export function isDashboardView(value: unknown): value is DashboardViewKey {
  return typeof value === "string" && DASHBOARD_VIEWS.some((view) => view.key === value);
}

/**
 * The views this reader gets, in order. Overview always; a module view only with an open page behind it, under the
 * menu's own narrowing (`gate`: the agency's own screens for a narrowed session, extra roles, hidden pages), so no
 * view is offered whose cards would all be hidden (roles r1: a setter's empty Compliance tab).
 */
export function dashboardViews(granted: Iterable<string>, role: TenantRole, solo = false, gate: MenuGate = {}): Array<{ key: DashboardViewKey; label: string; href: string }> {
  const features = [...granted];
  return DASHBOARD_VIEWS.filter((view) => view.key === "overview" || (!(view.wideOnly && gate.narrow) && firstOpenable(view.opens, features, role, solo, gate) !== null)).map((view) => ({
    key: view.key,
    label: view.label,
    href: view.key === "overview" ? "/app/dashboard" : `/app/dashboard?view=${view.key}`,
  }));
}

/** The view to draw: the one asked for when this reader has it, else Overview. */
export function pickDashboardView(asked: unknown, offered: ReadonlyArray<{ key: DashboardViewKey }>): DashboardViewKey {
  return isDashboardView(asked) && offered.some((view) => view.key === asked) ? asked : "overview";
}
