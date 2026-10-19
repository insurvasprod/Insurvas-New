import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgencyDashboard } from "@/components/app/agency/agency-dashboard";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** AG-0.11 · the agency dashboard. Owner, admin, bookkeeper; a manager sees his reports; a producer never. */
export default async function AgencyDashboardPage() {
  const guard = await guardPage("agency_dashboard");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Agency dashboard" description="Which of your producers is actually making you money." />;
  const manager = guard.context.memberRole === "manager";
  if (!(["owner", "bookkeeper"].includes(guard.role) || manager)) {
    return <RoleGateNotice featureLabel="Agency dashboard" detail="The owner, admins, managers and the bookkeeper see the agency dashboard." />;
  }
  const { data } = await getSupabaseServiceClient().from("agency" as never).select("legal_name, dba_name").eq("tenant_id", guard.context.tenantId).maybeSingle<{ legal_name: string; dba_name: string | null }>();
  return <AgencyDashboard agencyName={data?.dba_name ?? data?.legal_name ?? "Your agency"} scoped={manager} />;
}
