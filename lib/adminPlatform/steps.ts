// Admin › Platform as one area (admin round 1, owner 2026-11-18: "Platform on the sidebar needs to be similar to Catalog
// and Monitoring"): the steps down the rail, grouped, read from the role's own admin menu (lib/adminNav/build.ts) so the
// menu, the rail and the routes can never disagree. Plain module: testable without a server. Twins:
// lib/adminCatalog/steps.ts and lib/adminMonitoring/steps.ts.

import type { AdminRole } from "../adminAuth/roles.ts";
import { buildAdminNav } from "../adminNav/build.ts";

export type PlatformStep = "workspace" | "compliance" | "disclosures" | "calling" | "mail" | "maintenance" | "advanced" | "admins" | "legal";

type StepDef = { key: PlatformStep; label: string; href: string; icon: string; group: string };

/** Every step in rail order. `icon` is a StepRail icon key (the admin sidebar's own picture); `group` the small label. */
export const PLATFORM_STEPS: readonly StepDef[] = [
  { key: "workspace", label: "Workspace", href: "/admin/platform", icon: "layout-grid", group: "Overview" },
  { key: "compliance", label: "Compliance", href: "/admin/compliance-sources", icon: "shield-check", group: "Rules" },
  { key: "disclosures", label: "Disclosures", href: "/admin/state-disclosures", icon: "file-warning", group: "Rules" },
  { key: "calling", label: "Calling rules", href: "/admin/calling-rules", icon: "phone-off", group: "Rules" },
  { key: "mail", label: "Mail setup", href: "/admin/email", icon: "mail", group: "Communication" },
  { key: "maintenance", label: "Maintenance", href: "/admin/system", icon: "server-cog", group: "System" },
  { key: "advanced", label: "Advanced", href: "/admin/advanced", icon: "sliders-horizontal", group: "System" },
  { key: "admins", label: "Admin users", href: "/admin/admins", icon: "user-cog", group: "People & records" },
  { key: "legal", label: "Legal", href: "/admin/legal", icon: "scale", group: "People & records" },
];

export const PLATFORM_RAIL_COOKIE = "insurvas-admin-platform-rail";

/** What each step's badge counts (GET /api/admin/platform/steps), singular and plural. Only what waits on an admin. */
export const PLATFORM_WAITING: Record<string, [string, string]> = {
  workspace: ["thing needs a look", "things need a look"],
  compliance: ["screening vendor is unreachable", "screening vendors are unreachable"],
  disclosures: ["disclosure change waits for review", "disclosure changes wait for review"],
  calling: ["rules review is overdue", "rules reviews are overdue"],
  mail: ["mail setting is missing", "mail settings are missing"],
  maintenance: ["maintenance window is on or scheduled", "maintenance windows are on or scheduled"],
  admins: ["active admin has no two-factor sign-in", "active admins have no two-factor sign-in"],
  legal: ["legal draft is unpublished", "legal drafts are unpublished"],
};

function menuHrefs(role: AdminRole): Set<string> {
  const hrefs = new Set<string>();
  for (const node of buildAdminNav(role)) {
    if (node.kind === "group") node.links.forEach((link) => hrefs.add(link.href));
    else hrefs.add(node.href);
  }
  return hrefs;
}

/** The steps this role may open, in order: exactly what the role's admin menu offers. */
export function platformStepsFor(role: AdminRole): StepDef[] {
  const open = menuHrefs(role);
  return PLATFORM_STEPS.filter((step) => open.has(step.href));
}

export function platformStepLabel(step: PlatformStep): string {
  return PLATFORM_STEPS.find((item) => item.key === step)?.label ?? "Platform";
}
