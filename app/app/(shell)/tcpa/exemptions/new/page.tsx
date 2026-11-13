import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TcpaExemptionForm } from "@/components/app/tcpa-dnc-exemptions";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";

/**
 * Compliance › TCPA / DNC › Record an exemption (LA-2.3-3; foundation pass 2026-11-03, was a pop-up). Clears
 * federal and state DNC for one number on a recorded consent certificate or business relationship. The owner
 * only, never read-only — the API's write role.
 */
export default async function NewExemptionPage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="TCPA / DNC" description="Numbers you must never call, and a check before dialling." />;
  if (!actAsPage(guard, ["owner"])) return <RoleGateNotice featureLabel="DNC exemptions" detail="Only the agency owner records a DNC exemption." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="DNC exemptions" detail="In an agency, the owner and admins keep the DNC exemptions." />;
  if (guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="DNC exemptions" detail="This plan is read-only here: exemptions can be seen, not recorded." />;
  return (
    <ComplianceFlowPage step="dnc" title="Record an exemption">
      <TcpaExemptionForm />
    </ComplianceFlowPage>
  );
}
