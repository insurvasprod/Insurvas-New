import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { ADMIN_ROLE_LABELS } from "@/lib/adminAuth/roles";
import { buildAdminNav } from "@/lib/adminNav/build";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopBar } from "@/components/admin/admin-top-bar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  // The sidebar owns its own width, so the whole aside is a client component; the server's job is
  // only to decide what this role may see. Role gating stays here, never in the browser.
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminSidebar
        nodes={buildAdminNav(admin.role)}
        adminName={admin.name}
        roleLabel={ADMIN_ROLE_LABELS[admin.role]}
      />
      {/* min-w-0 is load-bearing. A flex item defaults to min-width:auto, so <main> refused to
          shrink below its widest child — a wide table pushed main, main pushed the page, and the
          sidebar scrolled off the left on every screen with a table. With it, main can shrink and
          the table scrolls inside its own overflow-x-auto container instead (see table-styles.ts). */}
      <main className="min-w-0 flex-1 bg-[var(--color-page-bg)] flex flex-col">
        <AdminTopBar
          user={{
            name: admin.name,
            email: admin.email,
            roleLabel: ADMIN_ROLE_LABELS[admin.role],
            workspaceName: "Insurvas staff",
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8">
        {children}
      </div>
      </main>
    </div>
  );
}
