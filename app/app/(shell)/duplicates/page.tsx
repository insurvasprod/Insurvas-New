import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ContactWorkspace } from "@/components/app/contact-workspace";
import { guardPage } from "@/lib/entitlements/guardPage";

export default async function DuplicatesPage() {
  const guard = await guardPage("duplicate_detection");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Duplicate check" description="Find probable household duplicates before you pay for the same person twice." />;
  return <ContactWorkspace />;
}
