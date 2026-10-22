import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AssignmentWorkspace } from "@/components/app/assignment-workspace";
import { UnassignedPool } from "@/components/app/agency/unassigned-pool";
import { isAgencyTenant } from "@/lib/agency/audience";

export default async function AssignmentsPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead assignment" description="Route leads by state, licence and capacity." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant", "setter"])) return <RoleGateNotice featureLabel="Lead assignment" detail="Only owners, producers, assistants and setters can work the assignment pool." />;
  // AG-0.10 · in an agency the leads are the agency's and the owner (or an admin) routes them; a producer works
  // the leads assigned to him, in his own queue.
  const agency = await isAgencyTenant(guard.context.tenantId);
  if (agency && guard.role !== "owner") return <RoleGateNotice reason="agency" featureLabel="Lead assignment" detail="In an agency the owner or an admin routes leads. Your assigned leads are in your queue." />;
  return (
    <>
      <AssignmentWorkspace canManage={holdsAnyRole(guard.roles, ["owner", "producer"])} />
      {agency && <div className="mt-4"><UnassignedPool /></div>}
    </>
  );
}
