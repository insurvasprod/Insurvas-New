import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AssignmentWorkspace } from "@/components/app/assignment-workspace";
import { isAgencyTenant } from "@/lib/agency/audience";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

export default async function AssignmentsPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead assignment" description="Route leads by state, licence and capacity." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant", "setter"])) return <RoleGateNotice featureLabel="Lead assignment" detail="Only owners, producers, assistants and setters can work the assignment pool." />;
  // AG-0.10 · in an agency the leads are the agency's and the owner (or an admin) routes them; a producer works
  // the leads assigned to him, in his own queue.
  const [agency, solo] = await Promise.all([isAgencyTenant(guard.context.tenantId), isSoloWorkspace(guard.context.tenantId)]);
  // Solo mode (owner 2026-10-29): an individual agent with no other caller has nobody to route to.
  if (solo) return <RoleGateNotice reason="solo" featureLabel="Lead routing" detail="You work alone, so new leads go straight to your dialer." action={{ href: "/app/dialer", label: "Open the dialer" }} />;
  if (agency && guard.role !== "owner") return <RoleGateNotice reason="agency" featureLabel="Lead assignment" detail="In an agency the owner or an admin routes leads. Your assigned leads are in your queue." />;
  // One page with the agency's Lead routing (2026-10-26): in an agency the unassigned pool is a tab.
  // Step 5 · Route of the one Leads page (owner pick B, 2026-10-28).
  return <LeadsInPage step="route"><AssignmentWorkspace canManage={holdsAnyRole(guard.roles, ["owner", "producer"])} pool={agency} /></LeadsInPage>;
}
