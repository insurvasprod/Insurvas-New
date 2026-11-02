import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ConsentLockerWorkspace } from "@/components/app/consent-locker-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";

/**
 * LA-2.6 · `/app/consent`.
 *
 * The table, the ingest writer, the claim job and the dialer's read all existed. What did not was
 * a way to find one certificate months later, when a complaint names one person — which is the only
 * moment a consent locker is ever used.
 */
export default async function ConsentPage() {
  const guard = await guardPage("consent_locker");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Consent locker"
        description="Every consent certificate, searchable, with our stored copy."
      />
    );
  if (!actAsPage(guard, ["owner", "producer", "assistant"]))
    return <RoleGateNotice featureLabel="Consent locker" detail="Only owners, producers and assistants can open the consent locker." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Consent locker" detail="In an agency, the owner and admins handle the consent locker." />;

  // The Consent step of the one Compliance page (2026-10-30): the frame draws the title; the workspace puts
  // its tabs and Export into the frame's top row. Export follows the list's filters (with none set it is the whole locker).
  return <ComplianceFlowPage step="consent"><ConsentLockerWorkspace /></ComplianceFlowPage>;
}
