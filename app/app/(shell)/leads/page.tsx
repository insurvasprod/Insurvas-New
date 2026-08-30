import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LeadWorkspace } from "@/components/app/lead-workspace";

export default async function LeadsPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead workspace" description="Capture, filter and move leads using your platform template." />;
  return <LeadWorkspace />;
}
