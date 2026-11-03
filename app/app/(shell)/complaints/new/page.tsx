import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { complaintPeople } from "@/lib/compliance/complaintPeople";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { NewComplaintForm } from "@/components/app/compliance/complaints-board";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";

/**
 * Compliance › Complaints › Record a complaint (LA-6.4; foundation pass 2026-11-03, was a 620px pop-up). A
 * complaint about unwanted calls puts the number on the do-not-call list as it is saved, and the number's
 * evidence report is attached. Owner and producer, never read-only.
 */
export default async function NewComplaintPage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Complaints" description="Every complaint with an owner, a deadline and a countdown." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Complaints" detail="Only owners and producers can see consumer complaints." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Complaints" detail="In an agency, the owner and admins handle complaints." />;
  if (guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Complaints" detail="This plan is read-only here: complaints can be read, not recorded." />;
  const { team, partners } = await complaintPeople(guard.context.tenantId);
  return (
    <ComplianceFlowPage step="complaints" title="Record a complaint">
      <NewComplaintForm team={team} partners={partners} />
    </ComplianceFlowPage>
  );
}
