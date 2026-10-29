// The admin home, composed per role (dashboards pass, 2026-10-13). Plain module: no database and no
// `server-only`, so which role sees which figure and link is testable on its own, and the page, the
// queries and the tests all read the same rules.
//
// One rule decides everything here: a role is shown a figure or a link only when it can open the
// page behind it, and "can open" is the admin nav's answer (lib/adminNav/build.ts buildAdminNav),
// which itself asks the same can*() checks every control-plane route enforces. The home never
// keeps a permission list of its own, so it cannot drift from the rail or the routes.

import type { AdminRole } from "../adminAuth/roles.ts";
import { buildAdminNav } from "../adminNav/build.ts";
import { formatCentsAsCurrency } from "../money.ts";

/* ── Who may open what ─────────────────────────────────────────────────────────────────────── */

/** Every page the role's rail offers, the dashboard itself included. */
export function adminOpenablePaths(role: AdminRole): string[] {
  return buildAdminNav(role).flatMap((node) => (node.kind === "group" ? node.links : [node])).map((link) => link.href);
}

/**
 * Whether the role can open `href`: its path is a page on the role's rail, or a record under one
 * (/admin/tenants/<id> under /admin/tenants). The query string is ignored; it filters, it does not
 * grant. "/admin" matches only itself, or every admin path would pass.
 */
export function canOpenAdminHref(role: AdminRole, href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  return adminOpenablePaths(role).some((base) => path === base || (base !== "/admin" && path.startsWith(`${base}/`)));
}

/* ── Which figures a role gets ─────────────────────────────────────────────────────────────── */

/**
 * The figure set on the role's strip. Revenue is SA-3.9's (super_admin and billing_admin, the roles
 * that may open /admin/revenue); support is the customer-facing set; platform is the configuration
 * set for platform_config, which sees no customer or money data at all (Basic Idea doc §2.5).
 */
export type HomeFigureSet = "revenue" | "support" | "platform";

export function homeFigureSet(role: AdminRole): HomeFigureSet {
  if (canOpenAdminHref(role, "/admin/revenue")) return "revenue";
  if (canOpenAdminHref(role, "/admin/tenants")) return "support";
  return "platform";
}

/* ── The figures, as tiles ─────────────────────────────────────────────────────────────────── */

export type HomeTileTone = "default" | "success" | "warning" | "error";

export type HomeTile = {
  key: string;
  label: string;
  value: string;
  footnote: string;
  tone?: HomeTileTone;
  /** Month-over-month, in percent. Only on a figure that has a base to compare with. */
  delta?: { value: number; unit: string; goodWhen: "up" | "down" };
  /** "text" for a word (a maintenance level) rather than a number. */
  valueSize?: "text";
  /** The page that lists the rows behind the figure (LA-4.20). Always one the role can open. */
  href: string;
  /** The link's accessible name: what opening it shows. */
  linkLabel: string;
};

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

/** SA-3.9's headline figures, read from the nightly metrics snapshot and the invoice table. */
export type RevenueFigures = {
  /** The newest metrics_daily day, or null when no snapshot has been computed. */
  snapshotDate: string | null;
  snapshotAgeDays: number | null;
  mrrCents: number;
  /** MRR on the snapshot day ~30 days before the newest one; null when there is none. */
  mrrMonthAgoCents: number | null;
  activeCustomers: number;
  newThisMonth: number;
  churnedThisMonth: number;
  invoicedThisMonthCents: number;
  collectedThisMonthCents: number;
  mismatchedInvoices: number;
  overdueInvoices: number;
  trialsInFlight: number;
  trialsEndingThisWeek: number;
};

/** The customer-facing set: tenants, sign-ins, users and the audit trail. */
export type SupportFigures = {
  tenants: number;
  suspendedTenants: number;
  signedInLast15Min: number;
  signInsToday: number;
  failedSignInsToday: number;
  invitedUsers: number;
  invitedStale: number;
  /** Audit rows today: everyone's for a super_admin, the viewer's own otherwise (as /admin/audit-log). */
  auditToday: number;
  auditWeek: number;
  auditIsOwn: boolean;
};

/** The configuration set: maintenance, announcements, kill switches and compliance sources. */
export type PlatformFigures = {
  maintenanceLevel: "off" | "banner_only" | "read_only" | "locked";
  /** The level a maintenance window that has not started yet will apply. */
  maintenanceScheduled: "banner_only" | "read_only" | "locked" | null;
  /** Null when announcements could not be read: shown as "—", never as 0. */
  announcementsLive: number | null;
  announcementsScheduled: number | null;
  featuresOff: number;
  featuresBeta: number;
  complianceSources: number;
  complianceSourcesFailing: number;
};

const MAINTENANCE_LABELS = { banner_only: "Banner only", read_only: "Read only", locked: "Locked" } as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Oct" from "2026-10-12". */
function snapshotLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return `${day.getUTCDate()} ${SHORT_MONTHS[day.getUTCMonth()]}`;
}

type SnapshotDay = { date: string; mrr_cents: number; active_customers: number; new_customers: number; churned_customers: number };

/**
 * The headline numbers out of the metrics_daily series (oldest first, as fetchMetrics returns it):
 * MRR and customers on the newest day, MRR on the newest day at least 30 days before it (the same
 * base the revenue page's 30-day window starts from), and new and churned customers summed over
 * this calendar month (UTC).
 */
export function summariseSnapshot(days: readonly SnapshotDay[], nowMs: number) {
  const latest = days.at(-1) ?? null;
  const monthStart = new Date(nowMs);
  const firstOfMonth = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}-01`;
  let monthAgo: SnapshotDay | null = null;
  if (latest) {
    const cutoff = new Date(Date.parse(`${latest.date}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
    for (const day of days) if (day.date <= cutoff) monthAgo = day;
  }
  const thisMonth = days.filter((day) => day.date >= firstOfMonth);
  return {
    mrrCents: latest?.mrr_cents ?? 0,
    mrrMonthAgoCents: monthAgo ? monthAgo.mrr_cents : null,
    activeCustomers: latest?.active_customers ?? 0,
    newThisMonth: thisMonth.reduce((sum, day) => sum + day.new_customers, 0),
    churnedThisMonth: thisMonth.reduce((sum, day) => sum + day.churned_customers, 0),
  };
}

/** Month-over-month change in percent, one decimal; null without a base to divide by. */
export function monthOverMonth(current: number, monthAgo: number | null): number | null {
  if (monthAgo === null || monthAgo <= 0) return null;
  return Math.round(((current - monthAgo) / monthAgo) * 1000) / 10;
}

export function revenueTiles(f: RevenueFigures): HomeTile[] {
  const change = monthOverMonth(f.mrrCents, f.mrrMonthAgoCents);
  const stale = f.snapshotAgeDays !== null && f.snapshotAgeDays > 1;
  const snapshot =
    f.snapshotDate === null
      ? "no snapshot computed yet"
      : stale
        ? `snapshot ${f.snapshotAgeDays} days old`
        : `snapshot ${snapshotLabel(f.snapshotDate)}`;
  const collectedShare =
    f.invoicedThisMonthCents > 0 ? `${Math.round((f.collectedThisMonthCents / f.invoicedThisMonthCents) * 100)}% of ${formatCentsAsCurrency(f.invoicedThisMonthCents)} invoiced` : "nothing invoiced this month";

  return [
    {
      key: "mrr",
      label: "MRR",
      // A missing snapshot is an absent figure, not a confident $0.
      value: f.snapshotDate === null ? "—" : formatCentsAsCurrency(f.mrrCents),
      footnote: change === null ? `${snapshot} · no month-ago base` : snapshot,
      tone: stale || f.snapshotDate === null ? "warning" : "default",
      delta: change === null ? undefined : { value: change, unit: "%", goodWhen: "up" },
      href: "/admin/revenue",
      linkLabel: "Open revenue",
    },
    {
      key: "customers",
      label: "Active customers",
      value: f.snapshotDate === null ? "—" : n(f.activeCustomers),
      footnote: `${n(f.newThisMonth)} new, ${n(f.churnedThisMonth)} churned this month`,
      href: "/admin/revenue",
      linkLabel: "Open revenue: customers and churn",
    },
    {
      key: "collected",
      label: "Collected this month",
      value: formatCentsAsCurrency(f.collectedThisMonthCents),
      footnote: collectedShare,
      href: "/admin/invoices",
      linkLabel: "Open invoices",
    },
    {
      key: "trials",
      label: "Trials ending this week",
      value: n(f.trialsEndingThisWeek),
      tone: f.trialsEndingThisWeek > 0 ? "warning" : "default",
      footnote: `${plural(f.trialsInFlight, "trial", "trials")} in flight`,
      href: "/admin/trials",
      linkLabel: "Open trials",
    },
    {
      key: "invoices",
      label: "Mismatched invoices",
      value: n(f.mismatchedInvoices),
      tone: f.mismatchedInvoices > 0 ? "error" : "default",
      footnote: `${n(f.overdueInvoices)} overdue`,
      href: "/admin/invoices",
      linkLabel: "Open invoices: mismatched and overdue",
    },
  ];
}

export function supportTiles(f: SupportFigures): HomeTile[] {
  return [
    {
      key: "tenants",
      label: "Tenants",
      value: n(f.tenants),
      tone: f.suspendedTenants > 0 ? "warning" : "default",
      footnote: `${n(f.suspendedTenants)} suspended`,
      href: "/admin/tenants",
      linkLabel: "Open tenants",
    },
    {
      key: "signed-in",
      label: "Signed in, last 15 min",
      value: n(f.signedInLast15Min),
      footnote: `${plural(f.signInsToday, "sign-in", "sign-ins")} today`,
      href: "/admin/activity",
      linkLabel: "Open login activity",
    },
    {
      key: "failed",
      label: "Failed sign-ins today",
      value: n(f.failedSignInsToday),
      tone: f.failedSignInsToday > 0 ? "warning" : "default",
      footnote: "wrong password, locked or blocked",
      href: "/admin/activity",
      linkLabel: "Open login activity: failed attempts",
    },
    {
      key: "invites",
      label: "Stale invites",
      value: n(f.invitedStale),
      tone: f.invitedStale > 0 ? "warning" : "default",
      footnote: `of ${plural(f.invitedUsers, "invited user", "invited users")}`,
      href: "/admin/users",
      linkLabel: "Open users",
    },
    {
      key: "audit",
      label: f.auditIsOwn ? "Your audit events today" : "Audit events today",
      value: n(f.auditToday),
      footnote: `${n(f.auditWeek)} in 7 days`,
      href: "/admin/audit-log",
      linkLabel: "Open the audit log",
    },
  ];
}

export function platformTiles(f: PlatformFigures): HomeTile[] {
  const unread = f.announcementsLive === null;
  return [
    {
      key: "maintenance",
      label: "Maintenance",
      value: f.maintenanceLevel === "off" ? "Off" : MAINTENANCE_LABELS[f.maintenanceLevel],
      valueSize: "text",
      tone: f.maintenanceLevel === "off" ? "default" : f.maintenanceLevel === "banner_only" ? "warning" : "error",
      footnote: f.maintenanceScheduled ? `${MAINTENANCE_LABELS[f.maintenanceScheduled]} scheduled` : f.maintenanceLevel === "off" ? "customers unaffected" : "in force now",
      href: "/admin/system",
      linkLabel: "Open maintenance",
    },
    {
      key: "announcements",
      label: "Announcements live",
      value: unread ? "—" : n(f.announcementsLive ?? 0),
      footnote: unread ? "could not be read" : `${n(f.announcementsScheduled ?? 0)} scheduled`,
      href: "/admin/system",
      linkLabel: "Open maintenance: announcements",
    },
    {
      key: "features",
      label: "Features switched off",
      value: n(f.featuresOff),
      tone: f.featuresOff > 0 ? "warning" : "default",
      footnote: `${n(f.featuresBeta)} limited to named tenants`,
      href: "/admin/features",
      linkLabel: "Open features",
    },
    {
      key: "compliance",
      label: "Compliance sources",
      value: n(f.complianceSources),
      tone: f.complianceSourcesFailing > 0 ? "error" : "default",
      footnote: `${n(f.complianceSourcesFailing)} with failures in 24h`,
      href: "/admin/compliance-sources",
      linkLabel: "Open compliance sources",
    },
  ];
}

/** The tiles a role sees: its set, minus anything it cannot open (a belt over the set's braces). */
export function tilesFor(role: AdminRole, tiles: HomeTile[]): HomeTile[] {
  return tiles.filter((tile) => canOpenAdminHref(role, tile.href));
}

/* ── "Needs attention" ─────────────────────────────────────────────────────────────────────── */

/**
 * The staff alerts (lib/adminAlerts) the role can act on. buildStaffAlerts already filters by role,
 * except its seat-limit rows, which link to tenants for every role; a link the role cannot open is
 * dropped here rather than shown as a 403.
 */
export function attentionFor<T extends { link: string }>(role: AdminRole, alerts: T[]): T[] {
  return alerts.filter((alert) => canOpenAdminHref(role, alert.link));
}

/** What the empty "Needs attention" list tells the role to do next (LA-0.3: name the next action). */
export function attentionEmptyAction(role: AdminRole): { hint: string; href: string; label: string } {
  if (canOpenAdminHref(role, "/admin/invoices")) {
    const clear = canOpenAdminHref(role, "/admin/system") ? "No failed payments, stuck webhooks, failing compliance sources or maintenance." : "No failed payments or billing-run problems.";
    return { hint: `${clear} Reconcile this month's invoices next.`, href: "/admin/invoices", label: "Open invoices" };
  }
  if (canOpenAdminHref(role, "/admin/activity")) {
    return { hint: "No customer is at a seat limit. Check today's failed sign-ins next.", href: "/admin/activity", label: "Open login activity" };
  }
  return { hint: "Every compliance source is answering and maintenance is off. Review the compliance sources next.", href: "/admin/compliance-sources", label: "Open compliance sources" };
}

/* ── "Start here" ──────────────────────────────────────────────────────────────────────────── */

export type StartStep = { title: string; open?: boolean; links: { label: string; href: string }[] };

/** "Start here": three steps, each a list of pages. Links are unchanged from the previous dashboard. */
export const START_STEPS: readonly StartStep[] = [
  {
    title: "Establish who and what is active",
    open: true,
    links: [
      { label: "Tenants", href: "/admin/tenants" },
      { label: "Users", href: "/admin/users" },
    ],
  },
  {
    title: "Configure what customers can buy",
    links: [
      { label: "Plans", href: "/admin/plans" },
      { label: "Features", href: "/admin/features" },
      { label: "Products", href: "/admin/products" },
    ],
  },
  {
    title: "Verify changes and platform health",
    links: [
      { label: "Audit log", href: "/admin/audit-log" },
      { label: "Maintenance", href: "/admin/system" },
      { label: "Compliance", href: "/admin/compliance-sources" },
    ],
  },
];

/** The steps with only the pages the role can open; a step left with none is dropped, and the first kept step starts open. */
export function startStepsFor(role: AdminRole): StartStep[] {
  const steps = START_STEPS.map((step) => ({ ...step, links: step.links.filter((link) => canOpenAdminHref(role, link.href)) })).filter((step) => step.links.length > 0);
  return steps.map((step, index) => ({ ...step, open: index === 0 }));
}
