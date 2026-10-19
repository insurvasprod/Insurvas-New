import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AssignmentWorkspace } from "@/components/app/assignment-workspace";
import { UnassignedPool } from "@/components/app/agency/unassigned-pool";
import { hasFeature } from "@/lib/entitlements/types";

/**
 * AG-0.10 · Team › Lead routing. Not a new lead system: LA-2.24's rule chain (state, language, campaign, product,
 * round robin, fewest open, best recent placement), which in an agency routes only to working producers appointed
 * in the lead's state — plus the unassigned pool with an age on every lead. Owner and admin only.
 */
export default async function LeadRoutingPage() {
  const guard = await guardPage("lead_assignment");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead routing" description="Give every lead to a producer who can write it." />;
  if (guard.role !== "owner") return <RoleGateNotice featureLabel="Lead routing" detail="In an agency the owner or an admin routes leads. Your assigned leads are in your queue." />;
  return (
    <>
      {hasFeature(guard.entitlement, "outbound_dialing") && <AssignmentWorkspace canManage />}
      <div className="mt-4"><UnassignedPool /></div>
    </>
  );
}
