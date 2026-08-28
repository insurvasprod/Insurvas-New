import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { TenantsTable } from "@/components/admin/tenants-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { canViewTenants } from "@/lib/tenants/permissions";

export default async function TenantsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewTenants(admin.role)) redirect("/admin");

  const supabase = getSupabaseServiceClient();

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, status, plan_code, onboarding_state, created_at, suspended_at")
    .order("created_at", { ascending: true });

  const { data: owners } = await supabase
    .from("tenant_users")
    .select("tenant_id, users(name, email)")
    .eq("role", "owner")
    .returns<{ tenant_id: string; users: { name: string; email: string } | null }[]>();

  const ownerByTenant = new Map((owners ?? []).map((row) => [row.tenant_id, row.users]));
  const withOwners = (tenants ?? []).map((tenant) => ({ ...tenant, owner: ownerByTenant.get(tenant.id) ?? null }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Tenants"
        subtitle="Every customer account on the platform. Suspend/reactivate and billing land in later tickets."
      />
      <TenantsTable initialTenants={withOwners} />
    </div>
  );
}
