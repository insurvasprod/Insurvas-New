import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { canViewUsers } from "@/lib/users/permissions";
import { fetchUserLoginEvents } from "@/lib/loginEvents/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { UserDetailSummary } from "@/components/admin/user-detail-summary";
import { LoginActivityTable } from "@/components/admin/login-activity-table";
import type { UserListRow } from "@/lib/users/list";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewUsers(admin.role)) redirect("/admin");

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: user } = await supabase
    .from("admin_user_list")
    .select(
      "id, name, email, phone, status, tenant_id, tenant_name, tenant_role, plan_code, last_login_at, created_at, has_password, suspended_at, suspension_reason, distinct_ips_24h",
    )
    .eq("id", id)
    .maybeSingle();

  if (!user) notFound();

  const events = await fetchUserLoginEvents(id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to users
      </Link>

      <AdminPageHeader title={user.name ?? "User"} subtitle={user.email ?? ""} />

      <UserDetailSummary user={user as unknown as UserListRow & { distinct_ips_24h: number | null; phone: string | null }} />

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Login activity</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          The 50 most recent attempts, successful or not.
        </p>
        <LoginActivityTable events={events} />
      </div>
    </div>
  );
}
