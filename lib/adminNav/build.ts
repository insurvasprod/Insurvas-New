import type { AdminRole } from "../adminAuth/roles.ts";
import { canViewTenants } from "../tenants/permissions.ts";
import { canViewUsers } from "../users/permissions.ts";
import { canManagePlans } from "../plans/permissions.ts";
import { canManageSubscriptions } from "../subscriptions/permissions.ts";
import { canViewInvoices } from "../invoices/permissions.ts";
import { canManageCoupons } from "../coupons/permissions.ts";
import {
  canAccessConfigurationSection,
  type ConfigurationSectionSlug,
} from "../configuration/sections.ts";
import { group, isLinkActive, link, type SidebarIconKey, type SidebarLink, type SidebarNode } from "./types.ts";

/**
 * The admin sidebar, grouped.
 *
 * The groups follow the permission boundaries that already exist rather than a tidy-sounding
 * taxonomy, so a group is almost never half-empty: "Customers" is exactly what a support_agent can
 * reach, and "Billing" is exactly what a billing_admin adds on top.
 *
 * That is why Subscriptions and Trials live under Billing and not under Customers. They read like
 * customer data, but they are gated by canManageSubscriptions — the same permission as Invoices and
 * Revenue, not the one that gates Tenants. Filing them by how they read would leave both groups
 * showing gaps to the role that uses them most.
 *
 * Platform holds the platform-configuration screens. These used to sit behind a "Configuration
 * Center" hub page; the hub is gone and each section is its own route, so they appear here
 * directly. They are still gated by the same per-section role map the hub used, which is why they
 * ask `canAccessConfigurationSection` rather than a permission of their own — one place decides,
 * and the page and the link can never disagree about it.
 *
 * Several are filed by who reaches for them rather than by which ticket built them, while still
 * carrying the section registry's permission: Features, Products and Templates under Catalog;
 * payment Setup, Offers and Credits & limits under Billing. Platform keeps what is genuinely
 * platform plumbing.
 */
/** The Billing group as an area: its home is the workspace when the role may open it, else its first page. */
function asArea(nodes: SidebarNode[]): SidebarNode[] {
  const only = nodes[0];
  if (!only || only.kind !== "group") return nodes;
  return [{ ...only, area: only.links[0].href }];
}
function billingArea(links: (SidebarLink | null)[]): SidebarNode[] {
  return asArea(group("billing", "Billing", "billing", links));
}

export function buildAdminNav(role: AdminRole): SidebarNode[] {
  const tenants = canViewTenants(role);
  const users = canViewUsers(role);
  const plans = canManagePlans(role);
  const subscriptions = canManageSubscriptions(role);
  const invoices = canViewInvoices(role);
  const coupons = canManageCoupons(role);
  const isSuperAdmin = role === "super_admin";

  /** A platform-configuration screen, rendered only for a role the section registry admits. */
  const section = (
    slug: ConfigurationSectionSlug,
    href: string,
    label: string,
    icon: SidebarIconKey,
  ) => (canAccessConfigurationSection(role, slug) ? link(href, label, icon) : null);

  return [
    link("/admin", "Dashboard", "dashboard"),

    ...group("customers", "Customers", "customers", [
      tenants ? link("/admin/tenants", "Tenants", "tenants") : null,
      users ? link("/admin/users", "Users", "users") : null,
    ]),

    // Billing is one area (admin round 1, owner 2026-11-17): its row opens the Billing workspace and hovering it lists
    // every page; inside, the pages are steps down a rail (components/admin/billing/billing-page.tsx). Each link keeps
    // its own route and its own permission, so the rail, this menu and the routes can never disagree.
    ...billingArea([
      invoices ? link("/admin/billing", "Workspace", "billing-workspace") : null,
      subscriptions ? link("/admin/subscriptions", "Subscriptions", "subscriptions") : null,
      subscriptions ? link("/admin/trials", "Trials", "trials") : null,
      subscriptions ? link("/admin/billing/failed-payments", "Failed payments", "failed-payments") : null,
      // SA-3.3: a support_agent cannot open invoice screens at all, so no link is rendered for
      // them — a visible link to a 403 is worse than no link.
      invoices ? link("/admin/invoices", "Invoices", "invoices") : null,
      invoices ? link("/admin/credit-notes", "Refunds & credits", "credit-notes") : null,
      invoices ? link("/admin/billing/reconciliation", "Reconciliation", "reconciliation") : null,
      coupons ? link("/admin/coupons", "Coupons", "coupons") : null,
      // Beside Coupons on purpose: SA-4.4 is the campaign layer over the SA-3.6 coupon.
      section("offers", "/admin/offers", "Offers & discounts", "offers"),
      // Credit packs are priced and sold, and the usage monitor is who is about to owe more —
      // both billing questions, even though the meters behind them are platform config.
      section("credits-limits", "/admin/credits-limits", "Credits & limits", "limits"),
      invoices ? link("/admin/revenue", "Revenue", "revenue") : null,
      // Payment provider: live provider credentials stay super_admin only (the section registry's rule), so a
      // billing admin sees Invoices and Coupons here but not this. At the rail's foot inside the area.
      section("payments", "/admin/payments", "Payment provider", "payments-setup"),
    ]),

    // Catalog is one area too (admin round 1, owner 2026-11-17; docs/design/admin-r1/catalog.html): its row opens the
    // Catalog workspace and hovering it lists every page; inside, the pages are steps down a rail
    // (components/admin/catalog/catalog-page.tsx). The workspace is for whoever may open any Catalog page.
    ...asArea(group("catalog", "Catalog", "catalog", [
      plans || canAccessConfigurationSection(role, "carriers") || canAccessConfigurationSection(role, "products") ? link("/admin/catalog", "Workspace", "catalog-workspace") : null,
      plans ? link("/admin/plans", "Plans", "plans") : null,
      plans ? link("/admin/addons", "Add-ons", "addons") : null,
      // Feature catalog AND kill switches. Sits with Plans and Add-ons because that is what it is
      // for day to day — the list you tick against when building a plan. It keeps the section
      // registry's permission rather than canManagePlans, so who may open it does not change.
      section("features", "/admin/features", "Features", "features"),
      // What the platform sells insurance-wise, and the workspace each product starts an agent
      // with. Catalog already means "the things we offer", so they belong here rather than with
      // the platform plumbing.
      section("products", "/admin/products", "Products", "products"),
      section("templates", "/admin/templates", "Templates", "templates"),
      section("carriers", "/admin/carriers", "Carriers", "carriers"),
      // LA-4.17 · the platform's default carrier rules and settings.
      section("carriers", "/admin/carrier-rules", "Carrier rules", "carrier-rules"),
      // LA-4.3 · how each carrier's spreadsheets are read. Same rule: it belongs to the carrier library.
      section("carriers", "/admin/layout-maps", "Layout maps", "layout-maps"),
      // LA-4.5 · carrier status words waiting to be mapped, and the status map.
      section("carriers", "/admin/status-maps", "Status maps", "status-maps"),
      // LA-3.13 · the platform's carrier field maps. Same permission as the carrier library it
      // belongs to: whoever may change a carrier may review where its application fields go.
      section("carriers", "/admin/field-maps", "Field maps", "field-maps"),
      // LA-4.10 · where each carrier's policy file lives in its portal, for the book import.
      section("carriers", "/admin/carrier-guidance", "Portal guidance", "portal-guidance"),
      // LA-5.4 · how each carrier takes a servicing change (part of the carrier record, as its rules).
      section("carriers", "/admin/servicing-guides", "Servicing instructions", "carrier-rules"),
      // Carrier fact reports (20261027200000): wrong carrier facts agencies reported from Settings ›
      // Carriers. Fixing one changes the carrier for everyone, so it keeps the carrier library's permission.
      section("carriers", "/admin/carrier-reports", "Fact reports", "fact-reports"),
    ])),

    // Monitoring is one area too (admin round 1, owner 2026-11-17; docs/design/admin-r1/monitoring.html): its row opens
    // the Monitoring workspace and hovering it lists every page (components/admin/monitoring/monitoring-page.tsx).
    // Lockouts and Staff sessions are security state: super_admin only, as the lockout panel and the sessions route are.
    ...asArea(group("monitoring", "Monitoring", "monitoring", [
      link("/admin/monitoring", "Workspace", "monitoring-workspace"),
      users ? link("/admin/activity", "Login activity", "activity") : null,
      isSuperAdmin ? link("/admin/monitoring/lockouts", "Lockouts", "lockouts") : null,
      isSuperAdmin ? link("/admin/monitoring/sessions", "Staff sessions", "staff-sessions") : null,
      link("/admin/audit-log", "Audit log", "audit-log"),
      link("/admin/monitoring/jobs", "Jobs & services", "jobs"),
    ])),

    // Platform is one area too (admin round 1, owner 2026-11-18): its row opens the Platform workspace and hovering it
    // lists every page; inside, the pages are steps down a rail (components/admin/platform/platform-page.tsx). Legal is
    // every admin's, so the workspace is too; it shows each role only what its own Platform pages hold.
    ...asArea(group("platform", "Platform", "platform", [
      // The workspace borrows the shared workspace picture (LayoutGrid) the Catalog and Monitoring workspaces draw.
      link("/admin/platform", "Workspace", "monitoring-workspace"),
      section("compliance-sources", "/admin/compliance-sources", "Compliance", "compliance"),
      section("state-disclosures", "/admin/state-disclosures", "Disclosures", "disclosures"),
      isSuperAdmin ? link("/admin/calling-rules", "Calling rules", "calling-rules") : null,
      section("email", "/admin/email", "Mail setup", "email"),
      section("system", "/admin/system", "Maintenance", "system"),
      section("advanced", "/admin/advanced", "Advanced", "advanced"),
      isSuperAdmin ? link("/admin/admins", "Admin users", "admins") : null,
      // Readable by every admin: an acceptance record is what a support agent needs in a dispute.
      link("/admin/legal", "Legal", "legal"),
    ])),
  ];
}

/**
 * The eyebrow an admin page shows above its title.
 *
 * Derived from the nav rather than typed on each page, for the reason `sectionForPath` gives on the
 * tenant side: this file already assigns every destination a section, so it is the answer, and two
 * dozen hand-written taxonomies would disagree with it within a month.
 *
 * The role is the SUPER ADMIN's deliberately — this asks "what section is this screen in", which is
 * a fact about the product, not about the reader. Passing the caller's role would make a page's own
 * eyebrow disappear for the roles that reach it through a shorter menu.
 */
export function adminSectionForPath(pathname: string): string | null {
  let best: { href: string; label: string } | null = null;
  for (const node of buildAdminNav("super_admin")) {
    if (node.kind !== "group") continue;
    for (const item of node.links) {
      if (!isLinkActive(item.href, pathname)) continue;
      if (!best || item.href.length > best.href.length) best = { href: item.href, label: node.label };
    }
  }
  return best?.label ?? null;
}
