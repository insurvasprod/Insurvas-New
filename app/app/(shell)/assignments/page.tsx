import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AssignmentWorkspace } from "@/components/app/assignment-workspace";

export default async function AssignmentsPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead assignment" description="Route leads by campaign, state, language and product while respecting licensing and capacity." />;
  if (!["owner", "producer", "assistant", "setter"].includes(guard.role)) return <RoleGateNotice featureLabel="Lead assignment" detail="Only owners, producers, assistants and setters can work the assignment pool." />;
  return <AssignmentWorkspace canManage={["owner", "producer"].includes(guard.role)} />;
}
