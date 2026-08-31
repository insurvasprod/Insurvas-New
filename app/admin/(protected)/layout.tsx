import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { ADMIN_ROLE_LABELS } from "@/lib/adminAuth/roles";
import { LogoutButton } from "@/components/admin/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { canManageCoupons } from "@/lib/coupons/permissions";
import { SidebarNav, type SidebarNavItem } from "@/components/admin/sidebar-nav";
import { canViewUsers } from "@/lib/users/permissions";
import { canViewTenants } from "@/lib/tenants/permissions";
import { canManageFeatures } from "@/lib/features/permissions";
import { canManagePlans } from "@/lib/plans/permissions";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { canAccessConfigurationCenter } from "@/lib/configuration/sections";

// Matches the Insurvas CRM sidebar surface (lib/theme.ts navSurfaceBg): a radial glow over a
// diagonal navy gradient, rather than a flat fill.
const SIDEBAR_SURFACE =
  "radial-gradient(900px 520px at 0% 0%, rgba(63,151,230,0.28) 0%, rgba(63,151,230,0.13) 34%, transparent 64%)," +
  "radial-gradient(760px 360px at 100% 0%, rgba(63,151,230,0.16) 0%, transparent 62%)," +
  "linear-gradient(135deg, #005ba8 0%, #00407f 32%, #003162 72%, #001f3f 100%)";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const navItems: SidebarNavItem[] = [{ href: "/admin", label: "Dashboard", icon: "dashboard" }];

  if (canViewTenants(admin.role)) {
    navItems.push({ href: "/admin/tenants", label: "Tenants", icon: "tenants" });
  }
  if (canViewUsers(admin.role)) {
    navItems.push({ href: "/admin/users", label: "Users", icon: "users" });
    navItems.push({ href: "/admin/activity", label: "Login activity", icon: "activity" });
  }
  if (canManagePlans(admin.role)) {
    navItems.push({ href: "/admin/plans", label: "Plans", icon: "plans" });
  }
  if (canManagePlans(admin.role)) {
    navItems.push({ href: "/admin/addons", label: "Add-ons", icon: "addons" });
  }
  if (canManageSubscriptions(admin.role)) {
    navItems.push({ href: "/admin/subscriptions", label: "Subscriptions", icon: "subscriptions" });
  }

  // SA-3.3: a support_agent cannot open invoice screens at all, so the link is not rendered for
  // them either — a visible link to a 403 is a worse experience than no link.
  if (canViewInvoices(admin.role)) {
    navItems.push({ href: "/admin/invoices", label: "Invoices", icon: "invoices" });
    navItems.push({ href: "/admin/credit-notes", label: "Refunds & credits", icon: "credit-notes" });
    navItems.push({ href: "/admin/revenue", label: "Revenue", icon: "revenue" });
  }

  if (canManageCoupons(admin.role)) {
    navItems.push({ href: "/admin/coupons", label: "Coupons", icon: "coupons" });
  }
  if (canManageFeatures(admin.role)) {
    navItems.push({ href: "/admin/features", label: "Features", icon: "features" });
  }
  if (admin.role === "super_admin") {
    navItems.push({ href: "/admin/admins", label: "Admin users", icon: "admins" });
  }
  if (canAccessConfigurationCenter(admin.role)) {
    navItems.push({ href: "/admin/configuration", label: "Configuration Center", icon: "configuration" });
  }
  navItems.push({ href: "/admin/audit-log", label: "Audit log", icon: "audit-log" });

  return (
    <div className="flex min-h-screen">
      <aside data-print-hide
        className="flex w-60 shrink-0 flex-col justify-between rounded-br-3xl p-4 text-white"
        style={{ background: SIDEBAR_SURFACE }}
      >
        <div>
          <div className="mb-8 flex items-center gap-2 px-2">
            <ShieldCheck className="size-5" />
            <span className="font-semibold tracking-tight">Insurvas Admin</span>
          </div>
          <SidebarNav items={navItems} />
        </div>
        <div className="border-t border-white/10 pt-4">
          <p className="truncate px-2 text-sm font-medium">{admin.name}</p>
          <p className="px-2 text-xs text-white/70">{ADMIN_ROLE_LABELS[admin.role]}</p>
          <div className="mt-3 space-y-2 px-2">
            <ThemeToggle tone="onBrand" />
            <LogoutButton />
          </div>
        </div>
      </aside>
      {/* min-w-0 is load-bearing. A flex item defaults to min-width:auto, so <main> refused to
          shrink below its widest child — a wide table pushed main, main pushed the page, and the
          sidebar scrolled off the left on every screen with a table. With it, main can shrink and
          the table scrolls inside its own overflow-x-auto container instead (see table-styles.ts).
          This is what backlog #52 was actually describing. */}
      <main className="min-w-0 flex-1 bg-[var(--color-page-bg)] p-8">{children}</main>
    </div>
  );
}
