import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ContactWorkspace } from "@/components/app/contact-workspace";
import { guardPage } from "@/lib/entitlements/guardPage";

export default async function DuplicatesPage() {
  const guard = await guardPage("duplicate_detection");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Duplicate check" description="Find probable household duplicates before you pay for the same person twice." />;
  // The contact APIs admit these three roles; anyone else would reach a page whose every read 403s.
  if (guard.role !== "owner" && guard.role !== "producer" && guard.role !== "assistant") {
    return <RoleGateNotice featureLabel="Duplicate check" detail="Only owners, producers and assistants can review and merge contacts." />;
  }
  return <ContactWorkspace readOnly={guard.entitlement.access !== "full"} />;
}
