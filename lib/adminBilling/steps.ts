// Admin › Billing as one area (admin round 1, owner 2026-11-17; docs/design/admin-r1/billing-r2.html): the steps down
// the rail, grouped, read from the role's own admin menu (lib/adminNav/build.ts). One source decides who sees which page,
// so the menu, the rail and the routes can never disagree. Plain module: testable without a server.

import type { AdminRole } from "../adminAuth/roles.ts";
import { buildAdminNav } from "../adminNav/build.ts";

export type BillingStep =
  | "workspace" | "subscriptions" | "trials" | "failed" | "invoices" | "refunds" | "reconciliation"
  | "coupons" | "offers" | "credits" | "revenue" | "provider";

type StepDef = { key: BillingStep; label: string; href: string; icon: string; group: string };

/** Every step in rail order. `icon` is a StepRail icon key; `group` the small label over each group. */
export const BILLING_STEPS: readonly StepDef[] = [
  { key: "workspace", label: "Workspace", href: "/admin/billing", icon: "layout-grid", group: "Overview" },
  { key: "subscriptions", label: "Subscriptions", href: "/admin/subscriptions", icon: "repeat", group: "Customers" },
  { key: "trials", label: "Trials", href: "/admin/trials", icon: "hourglass", group: "Customers" },
  { key: "failed", label: "Failed payments", href: "/admin/billing/failed-payments", icon: "circle-alert", group: "Customers" },
  { key: "invoices", label: "Invoices", href: "/admin/invoices", icon: "receipt", group: "Invoices" },
  { key: "refunds", label: "Refunds & credits", href: "/admin/credit-notes", icon: "undo-2", group: "Invoices" },
  { key: "reconciliation", label: "Reconciliation", href: "/admin/billing/reconciliation", icon: "scale-3d", group: "Invoices" },
  { key: "coupons", label: "Coupons", href: "/admin/coupons", icon: "tag", group: "Discounts" },
  { key: "offers", label: "Offers & discounts", href: "/admin/offers", icon: "badge-percent", group: "Discounts" },
  { key: "credits", label: "Credits & limits", href: "/admin/credits-limits", icon: "gauge", group: "Usage & reports" },
  { key: "revenue", label: "Revenue", href: "/admin/revenue", icon: "trending-up", group: "Usage & reports" },
  { key: "provider", label: "Payment provider", href: "/admin/payments", icon: "plug-zap", group: "Setup" },
];

export const BILLING_RAIL_COOKIE = "insurvas-admin-billing-rail";

/** What each step's badge counts (GET /api/admin/billing/steps), singular and plural. Only what waits on an admin. */
export const BILLING_WAITING: Record<string, [string, string]> = {
  workspace: ["thing needs you", "things need you"],
  trials: ["trial ends within 3 days with no card", "trials end within 3 days with no card"],
  failed: ["customer is past due", "customers are past due"],
  invoices: ["invoice is overdue", "invoices are overdue"],
  refunds: ["credit note waits for approval", "credit notes wait for approval"],
  reconciliation: ["invoice doesn't match the provider", "invoices don't match the provider"],
  credits: ["customer is over a limit", "customers are over a limit"],
};

/** The hrefs this role's admin menu offers (the Billing group, or its one link when the group collapsed). */
function menuHrefs(role: AdminRole): Set<string> {
  const hrefs = new Set<string>();
  for (const node of buildAdminNav(role)) {
    if (node.kind === "group") node.links.forEach((link) => hrefs.add(link.href));
    else hrefs.add(node.href);
  }
  return hrefs;
}

/** The steps this role may open, in order; Payment provider is not a step but the rail's foot. */
export function billingStepsFor(role: AdminRole): StepDef[] {
  const open = menuHrefs(role);
  return BILLING_STEPS.filter((step) => step.key !== "provider" && open.has(step.href));
}

/** The rail's foot (Payment provider) when the role may open it, else null. */
export function billingFootFor(role: AdminRole): { label: string; href: string } | null {
  const provider = BILLING_STEPS.find((step) => step.key === "provider")!;
  return menuHrefs(role).has(provider.href) ? { label: provider.label, href: provider.href } : null;
}

export function billingStepLabel(step: BillingStep): string {
  return BILLING_STEPS.find((item) => item.key === step)?.label ?? "Billing";
}
