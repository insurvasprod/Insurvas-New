import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { AdminPageHeader } from "@/components/admin/page-header";
import { UsersListTable } from "@/components/admin/users-list-table";
import { UsersListCreateUser } from "@/components/admin/users-list-create-user";
import { canViewUsers } from "@/lib/users/permissions";
import { fetchPlanCodes } from "@/lib/users/list";
import { fetchPlansForPicker } from "@/lib/plans/queries";
import { usersListQuerySchema } from "@/lib/adminUsersList/query";
import { fetchTenantOptions, fetchUsersListPage, fetchUsersListStats } from "@/lib/adminUsersList/directory";

export default async function UsersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewUsers(admin.role)) redirect("/admin");

  // Creating accounts and every row action are super_admin only (the routes enforce the same);
  // support and billing read the list.
  const canManage = admin.role === "super_admin";

  // First page, no filters; the client island takes over from here.
  const [{ users, total }, stats, planCodes, tenants, plans] = await Promise.all([
    fetchUsersListPage(usersListQuerySchema.parse({})),
    fetchUsersListStats(),
    fetchPlanCodes(),
    fetchTenantOptions(),
    canManage ? fetchPlansForPicker() : Promise.resolve([]),
  ]);
  // eslint-disable-next-line react-hooks/purity -- a server component reads the clock once per request
  const readAt = Date.now();

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Users"
        subtitle="Every user across every tenant. Search, filter, and manage account status."
        actions={canManage ? <UsersListCreateUser tenants={tenants} plans={plans} /> : undefined}
      />
      <UsersListTable
        initialUsers={users}
        initialTotal={total}
        initialStats={stats}
        planCodes={planCodes}
        tenants={tenants}
        canManage={canManage}
        readAt={readAt}
      />
    </div>
  );
}
