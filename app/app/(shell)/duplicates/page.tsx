import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { ContactWorkspace } from "@/components/app/contact-workspace";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";

export default async function DuplicatesPage() {
  const guard = await guardPage("duplicate_detection");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Duplicate check" description="Catch household duplicates before you pay twice." />;
  // The contact APIs admit these three roles; anyone else would reach a page whose every read 403s.
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) {
    return <RoleGateNotice featureLabel="Duplicate check" detail="Only owners, producers and assistants can review and merge contacts." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Duplicate check" detail="In an agency, the owner and admins review and merge duplicate contacts." />;
  return <ContactWorkspace readOnly={guard.entitlement.access !== "full"} />;
}
