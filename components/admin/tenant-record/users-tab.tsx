import type { TenantTabProps } from "@/components/admin/tenant-record/types";
import { loadTenantUsers } from "@/lib/adminTenantUsers/queries";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { canViewUsers } from "@/lib/users/permissions";
import { TenantUsersPanel } from "./users-tab-client";

/**
 * Users & seats tab (board p-adm-tenant-users). Server component: reads this tenant's people, seat
 * counts (the one seat rule, lib/tenantTeam/seats.ts) and 30-day sign-ins, and hands them to the
 * island. Only super_admin sees the write controls; support_agent and billing_admin read.
 */
export async function TenantUsersTab({ tenantId, admin }: TenantTabProps) {
  const data = await loadTenantUsers(tenantId);
  const superAdmin = admin.role === "super_admin";
  return (
    <TenantUsersPanel
      tenantId={tenantId}
      data={data}
      can={{
        revoke: superAdmin,
        export: superAdmin,
        changePlan: canManageSubscriptions(admin.role),
        openUser: canViewUsers(admin.role),
      }}
    />
  );
}
