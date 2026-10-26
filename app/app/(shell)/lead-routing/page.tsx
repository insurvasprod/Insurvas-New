import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AssignmentWorkspace } from "@/components/app/assignment-workspace";
import { UnassignedPool } from "@/components/app/agency/unassigned-pool";
import { hasFeature } from "@/lib/entitlements/types";
import { PageHeader } from "@/components/ui/page-header";
import { DashboardStage } from "@/components/ui/dashboard-stage";

/**
 * AG-0.10 · Team › Lead routing. Not a new lead system: LA-2.24's rule chain (state, language, campaign, product,
 * round robin, fewest open, best recent placement), which in an agency routes only to working producers appointed
 * in the lead's state — plus the unassigned pool with an age on every lead. Owner and admin only.
 */
export default async function LeadRoutingPage() {
  const guard = await guardPage("lead_assignment");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead routing" description="Give every lead to a producer who can write it." />;
  if (guard.role !== "owner") return <RoleGateNotice featureLabel="Lead routing" detail="In an agency the owner or an admin routes leads. Your assigned leads are in your queue." />;
  // The same page as /app/assignments (2026-10-26), the pool a tab on it. Without dialing there is no rule
  // chain to show, only the pool; the page still gets its one title.
  return (
    <DashboardStage ribbon>
      {hasFeature(guard.entitlement, "outbound_dialing")
        ? <AssignmentWorkspace canManage pool />
        : <div className="m-stagger flex w-full min-w-0 flex-col gap-6"><PageHeader title="Lead routing" /><UnassignedPool /></div>}
    </DashboardStage>
  );
}
