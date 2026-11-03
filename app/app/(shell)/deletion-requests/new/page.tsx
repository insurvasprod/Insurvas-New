import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { NewDeletionRequestForm } from "@/components/app/compliance/deletion-requests-board";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";

/**
 * Compliance › Deletions › Log a request (LA-6.5; foundation pass 2026-11-03, was a pop-up). Logged the day it
 * arrives; nothing is deleted until identity is verified and the hold has passed. Owner and producer, never
 * read-only.
 */
export default async function NewDeletionRequestPage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Deletion requests" description="When one person asks to be deleted: verify, hold, delete and certify." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Deletion requests" detail="Only owners and producers can see consumer deletion requests." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Deletion requests" detail="In an agency, the owner and admins handle deletion requests." />;
  if (guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Deletion requests" detail="This plan is read-only here: requests can be read, not logged." />;
  return (
    <ComplianceFlowPage step="deletions" title="Log a deletion request">
      <NewDeletionRequestForm />
    </ComplianceFlowPage>
  );
}
