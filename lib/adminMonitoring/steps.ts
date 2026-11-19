// Admin › Monitoring as one area (admin round 1, owner 2026-11-17; docs/design/admin-r1/monitoring.html): the steps
// down the rail, grouped, read from the role's own admin menu (lib/adminNav/build.ts). Billing's and Catalog's twins are
// lib/adminBilling/steps.ts and lib/adminCatalog/steps.ts.

import type { AdminRole } from "../adminAuth/roles.ts";
import { buildAdminNav } from "../adminNav/build.ts";

export type MonitoringStep = "workspace" | "logins" | "lockouts" | "sessions" | "audit" | "jobs";

type StepDef = { key: MonitoringStep; label: string; href: string; icon: string; group: string };

export const MONITORING_STEPS: readonly StepDef[] = [
  { key: "workspace", label: "Workspace", href: "/admin/monitoring", icon: "layout-grid", group: "Overview" },
  { key: "logins", label: "Login activity", href: "/admin/activity", icon: "log-in", group: "Sign-ins" },
  { key: "lockouts", label: "Lockouts", href: "/admin/monitoring/lockouts", icon: "lock-keyhole", group: "Sign-ins" },
  { key: "sessions", label: "Staff sessions", href: "/admin/monitoring/sessions", icon: "monitor-smartphone", group: "Sign-ins" },
  { key: "audit", label: "Audit log", href: "/admin/audit-log", icon: "scroll-text", group: "Records" },
  { key: "jobs", label: "Jobs & services", href: "/admin/monitoring/jobs", icon: "server-cog", group: "Health" },
];

export const MONITORING_RAIL_COOKIE = "insurvas-admin-monitoring-rail";

/** What each step's badge counts (GET /api/admin/monitoring/steps), singular and plural. */
export const MONITORING_WAITING: Record<string, [string, string]> = {
  workspace: ["thing is worth a look", "things are worth a look"],
  logins: ["failed sign-in today", "failed sign-ins today"],
  lockouts: ["account is locked", "accounts are locked"],
  jobs: ["job is failing", "jobs are failing"],
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
export function monitoringStepsFor(role: AdminRole): StepDef[] {
  const open = menuHrefs(role);
  return MONITORING_STEPS.filter((step) => open.has(step.href));
}

export function monitoringStepLabel(step: MonitoringStep): string {
  return MONITORING_STEPS.find((item) => item.key === step)?.label ?? "Monitoring";
}
