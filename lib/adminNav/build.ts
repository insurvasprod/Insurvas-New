import type { AdminRole } from "../adminAuth/roles.ts";
import { canViewTenants } from "../tenants/permissions.ts";
import { canViewUsers } from "../users/permissions.ts";
import { canManagePlans } from "../plans/permissions.ts";
import { canManageSubscriptions } from "../subscriptions/permissions.ts";
import { canViewInvoices } from "../invoices/permissions.ts";
import { canManageCoupons } from "../coupons/permissions.ts";
import { canManageFeatures } from "../features/permissions.ts";
import { canAccessConfigurationCenter } from "../configuration/sections.ts";
import { group, link, type SidebarNode } from "./types.ts";

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
 */
export function buildAdminNav(role: AdminRole): SidebarNode[] {
  const tenants = canViewTenants(role);
  const users = canViewUsers(role);
  const plans = canManagePlans(role);
  const subscriptions = canManageSubscriptions(role);
  const invoices = canViewInvoices(role);
  const coupons = canManageCoupons(role);
  const features = canManageFeatures(role);
  const configuration = canAccessConfigurationCenter(role);
  const isSuperAdmin = role === "super_admin";

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
    ]),

    ...group("catalog", "Catalog", "catalog", [
      plans ? link("/admin/plans", "Plans", "plans") : null,
      plans ? link("/admin/addons", "Add-ons", "addons") : null,
      features ? link("/admin/features", "Features", "features") : null,
    ]),

    ...group("monitoring", "Monitoring", "monitoring", [
      users ? link("/admin/activity", "Login activity", "activity") : null,
      link("/admin/audit-log", "Audit log", "audit-log"),
    ]),

    ...group("platform", "Platform", "platform", [
      // SA-4.3's hub. Sits here rather than at top level because it configures the platform
      // itself, which is exactly what this group means.
      configuration
        ? link("/admin/configuration", "Configuration Center", "configuration")
        : null,
      isSuperAdmin ? link("/admin/admins", "Admin users", "admins") : null,
      // Readable by every admin: an acceptance record is what a support agent needs in a dispute.
      link("/admin/legal", "Legal", "legal"),
    ]),
  ];
}
