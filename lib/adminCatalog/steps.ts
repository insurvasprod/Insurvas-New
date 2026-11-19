// Admin › Catalog as one area (admin round 1, owner 2026-11-17; docs/design/admin-r1/catalog.html): the steps down the
// rail, grouped, read from the role's own admin menu (lib/adminNav/build.ts) so the menu, the rail and the routes can
// never disagree. Plain module: testable without a server. Billing's twin is lib/adminBilling/steps.ts.

import type { AdminRole } from "../adminAuth/roles.ts";
import { buildAdminNav } from "../adminNav/build.ts";

export type CatalogStep =
  | "workspace" | "plans" | "addons" | "features" | "products" | "templates"
  | "carriers" | "rules" | "layouts" | "status" | "fields" | "guidance" | "servicing" | "reports";

type StepDef = { key: CatalogStep; label: string; href: string; icon: string; group: string };

/** Every step in rail order. `icon` is a StepRail icon key; `group` the small label over each group. */
export const CATALOG_STEPS: readonly StepDef[] = [
  { key: "workspace", label: "Workspace", href: "/admin/catalog", icon: "layout-grid", group: "Overview" },
  { key: "plans", label: "Plans", href: "/admin/plans", icon: "package", group: "What we sell" },
  { key: "addons", label: "Add-ons", href: "/admin/addons", icon: "puzzle", group: "What we sell" },
  { key: "features", label: "Features", href: "/admin/features", icon: "toggle-right", group: "What we sell" },
  { key: "products", label: "Products", href: "/admin/products", icon: "boxes", group: "Insurance" },
  { key: "templates", label: "Templates", href: "/admin/templates", icon: "layout-template", group: "Insurance" },
  { key: "carriers", label: "Carriers", href: "/admin/carriers", icon: "landmark", group: "Carriers" },
  { key: "rules", label: "Carrier rules", href: "/admin/carrier-rules", icon: "book-check", group: "Carriers" },
  { key: "layouts", label: "Layout maps", href: "/admin/layout-maps", icon: "table-properties", group: "Carriers" },
  { key: "status", label: "Status maps", href: "/admin/status-maps", icon: "list-checks", group: "Carriers" },
  { key: "fields", label: "Field maps", href: "/admin/field-maps", icon: "file-input", group: "Carriers" },
  { key: "guidance", label: "Portal guidance", href: "/admin/carrier-guidance", icon: "compass", group: "Carriers" },
  { key: "servicing", label: "Servicing instructions", href: "/admin/servicing-guides", icon: "wrench", group: "Carriers" },
  { key: "reports", label: "Fact reports", href: "/admin/carrier-reports", icon: "flag", group: "Carriers" },
];

export const CATALOG_RAIL_COOKIE = "insurvas-admin-catalog-rail";

/** What each step's badge counts (GET /api/admin/catalog/steps), singular and plural. Only what waits on an admin. */
export const CATALOG_WAITING: Record<string, [string, string]> = {
  workspace: ["thing waits for review", "things wait for review"],
  features: ["feature is switched off", "features are switched off"],
  templates: ["template draft", "template drafts"],
  rules: ["carrier is missing a rule", "carriers are missing a rule"],
  layouts: ["carrier has no live layout", "carriers have no live layout"],
  status: ["status word waits", "status words wait"],
  fields: ["field map waits for review", "field maps wait for review"],
  guidance: ["carrier has no portal guidance", "carriers have no portal guidance"],
  servicing: ["carrier has no servicing instructions", "carriers have no servicing instructions"],
  reports: ["fact report waits", "fact reports wait"],
};

function menuHrefs(role: AdminRole): Set<string> {
  const hrefs = new Set<string>();
  for (const node of buildAdminNav(role)) {
    if (node.kind === "group") node.links.forEach((link) => hrefs.add(link.href));
    else hrefs.add(node.href);
  }
  return hrefs;
}

/** The steps this role may open, in order. */
export function catalogStepsFor(role: AdminRole): StepDef[] {
  const open = menuHrefs(role);
  return CATALOG_STEPS.filter((step) => open.has(step.href));
}

export function catalogStepLabel(step: CatalogStep): string {
  return CATALOG_STEPS.find((item) => item.key === step)?.label ?? "Catalog";
}
