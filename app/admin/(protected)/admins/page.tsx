import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminUsersTable } from "@/components/admin/admin-users-table";
import { AdminPageHeader } from "@/components/admin/page-header";

export default async function AdminUsersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.role !== "super_admin") redirect("/admin");

  const supabase = getSupabaseServiceClient();
  const { data: admins } = await supabase
    .from("admin_users")
    .select("id, email, name, role, is_active, last_login_at, created_at")
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader title="Admin users" subtitle="Create and manage platform staff accounts. Super admin only." />
      <AdminUsersTable initialAdmins={admins ?? []} currentAdminId={admin.id} />
    </div>
  );
}
