import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { AdminPageHeader } from "@/components/admin/page-header";
import { UsersTable } from "@/components/admin/users-table";
import { canViewUsers } from "@/lib/users/permissions";
import { fetchPlanCodes, fetchUsersPage, fetchUserStats } from "@/lib/users/list";
import { usersQuerySchema } from "@/lib/users/query";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export default async function UsersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewUsers(admin.role)) redirect("/admin");

  // First page, no filters — the client takes over from here.
  const defaultQuery = usersQuerySchema.parse({});
  const [{ users, total }, stats, planCodes, tenantRows] = await Promise.all([
    fetchUsersPage(defaultQuery),
    fetchUserStats(),
    fetchPlanCodes(),
    getSupabaseServiceClient().from("tenants").select("id, name").order("name"),
  ]);

  // Creating accounts is super_admin only — support/billing can read the list but not provision.
  const canCreate = admin.role === "super_admin";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader
        title="Users"
        subtitle="Every user on the platform, across all tenants. Editing and lifecycle actions land in SA-1.2 – 1.4."
      />
      <UsersTable
        initialUsers={users}
        initialTotal={total}
        initialStats={stats}
        planCodes={planCodes}
        tenants={tenantRows.data ?? []}
        canCreate={canCreate}
      />
    </div>
  );
}
