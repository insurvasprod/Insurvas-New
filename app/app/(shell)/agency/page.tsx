import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgencyDashboard } from "@/components/app/agency/agency-dashboard";
import { AgencyPage } from "@/components/app/agency/agency-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { AGENCY_SLOT } from "@/components/app/agency/slots";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * AG-0.11 · the agency dashboard, Home › Agency (redesign 2026-11-03: no rail; Producers and every other agency page
 * are tiles on it). Owner, admin, bookkeeper; a manager sees his reports; a producer never.
 */
export default async function AgencyDashboardPage() {
  const guard = await guardPage("agency_dashboard");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Agency dashboard" description="Which of your producers is actually making you money." />;
  const manager = guard.context.memberRole === "manager";
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || manager)) {
    return <RoleGateNotice featureLabel="Agency dashboard" detail="The owner, admins, managers and the bookkeeper see the agency dashboard." />;
  }
  const { data } = await getSupabaseServiceClient().from("agency" as never).select("legal_name, dba_name").eq("tenant_id", guard.context.tenantId).maybeSingle<{ legal_name: string; dba_name: string | null }>();
  const agencyName = data?.dba_name ?? data?.legal_name ?? "Your agency";
  return (
    <AgencyPage
      step="overview"
      info={manager ? "Your reports: what they wrote, what it is worth, and what is at risk." : "Which of your producers is actually making the agency money."}
      facts={agencyName}
      actions={<StepSlotTarget id={AGENCY_SLOT} />}
    >
      <AgencyDashboard agencyName={agencyName} scoped={manager} slot={AGENCY_SLOT} canManage={guard.role === "owner" && guard.entitlement.access !== "read_only"} />
    </AgencyPage>
  );
}
