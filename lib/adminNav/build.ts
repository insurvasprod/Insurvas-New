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
import { group, link, type SidebarIconKey, type SidebarNode } from "./types.ts";

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
 * Two are filed by who reaches for them rather than by what built them, while still carrying the
 * section registry's permission: Features under Catalog, where someone building a plan expects it,
 * and payment Setup under Billing.
 */
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

    ...group("billing", "Billing", "billing", [
      subscriptions ? link("/admin/subscriptions", "Subscriptions", "subscriptions") : null,
      subscriptions ? link("/admin/trials", "Trials", "trials") : null,
      // SA-3.3: a support_agent cannot open invoice screens at all, so no link is rendered for
      // them — a visible link to a 403 is worse than no link.
      invoices ? link("/admin/invoices", "Invoices", "invoices") : null,
      invoices ? link("/admin/credit-notes", "Refunds & credits", "credit-notes") : null,
      coupons ? link("/admin/coupons", "Coupons", "coupons") : null,
      invoices ? link("/admin/revenue", "Revenue", "revenue") : null,
      // Payment provider, mode and keys. Filed with Billing because that is who reaches for it,
      // and named "Setup" because everything else in this group is a record while this is the
      // configuration behind them. It keeps the section registry's permission, which is stricter
      // than the rest of Billing: live provider credentials stay super_admin only, so a billing
      // admin sees Invoices and Coupons here but not this.
      section("payments", "/admin/payments", "Setup", "payments"),
    ]),

    ...group("catalog", "Catalog", "catalog", [
      plans ? link("/admin/plans", "Plans", "plans") : null,
      plans ? link("/admin/addons", "Add-ons", "addons") : null,
      // Feature catalog AND kill switches. Sits with Plans and Add-ons because that is what it is
      // for day to day — the list you tick against when building a plan. It keeps the section
      // registry's permission rather than canManagePlans, so who may open it does not change.
      section("features", "/admin/features", "Features", "features"),
    ]),

    ...group("monitoring", "Monitoring", "monitoring", [
      users ? link("/admin/activity", "Login activity", "activity") : null,
      link("/admin/audit-log", "Audit log", "audit-log"),
    ]),

    ...group("platform", "Platform", "platform", [
      section("offers", "/admin/offers", "Offers & discounts", "offers"),
      section("products", "/admin/products", "Products", "products"),
      section("templates", "/admin/templates", "Templates", "templates"),
      section("compliance-sources", "/admin/compliance-sources", "Compliance sources", "compliance"),
      section("credits-limits", "/admin/credits-limits", "Credits & limits", "limits"),
      section("email", "/admin/email", "Email", "email"),
      section("system", "/admin/system", "System", "system"),
      section("advanced", "/admin/advanced", "Advanced", "advanced"),
      isSuperAdmin ? link("/admin/admins", "Admin users", "admins") : null,
      // Readable by every admin: an acceptance record is what a support agent needs in a dispute.
      link("/admin/legal", "Legal", "legal"),
    ]),
  ];
}
