import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { adminsFootnote, roleFootnote, sortStaff, staffSummary, type StaffRow } from "@/lib/adminStaff/present";
import { AdminUsersTable } from "@/components/admin/admin-users-table";
import { CreateAdminDialog } from "@/components/admin/create-admin-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";

export default async function AdminUsersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.role !== "super_admin") redirect("/admin");

  const supabase = getSupabaseServiceClient();
  const { data: admins, error } = await supabase
    .from("admin_users")
    .select("id, email, name, role, is_active, last_login_at, created_at")
    .order("created_at", { ascending: true });

  // An empty staff list is impossible — the reader is looking at this page, so at least one row
  // exists. Rendering `?? []` would therefore turn a failed query into a screen that is not merely
  // unhelpful but visibly false.
  if (error) throw new Error(`Could not load admin users: ${error.message}`);

  const staff = sortStaff((admins ?? []) as StaffRow[]);
  const summary = staffSummary(staff);
  const onlyOneSuperAdmin = summary.activeSuperAdmins <= 1;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader title="Admin users" actions={<CreateAdminDialog />} />

      <BoardStatGrid>
        <BoardStatTile label="Admins" value={summary.total} footnote={adminsFootnote(summary)} />
        <BoardStatTile
          label="Super admins"
          value={summary.superAdmins}
          footnote={`${summary.activeSuperAdmins} active`}
          // The figure is a signal only when one more departure would leave nobody who can manage staff.
          tone={onlyOneSuperAdmin ? "warning" : "default"}
          title={onlyOneSuperAdmin ? "Only one super admin is active. The last one cannot be deactivated or demoted." : undefined}
        />
        <BoardStatTile label="Billing admins" value={summary.billingAdmins} footnote={roleFootnote(summary.billingDeactivated)} />
        <BoardStatTile label="Support agents" value={summary.supportAgents} footnote={roleFootnote(summary.supportDeactivated)} />
      </BoardStatGrid>

      <AdminUsersTable admins={staff} currentAdminId={admin.id} activeSuperAdmins={summary.activeSuperAdmins} />
    </div>
  );
}
