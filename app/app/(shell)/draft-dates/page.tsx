import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DraftDateCalculator } from "@/components/app/applications/draft-dates/draft-date-calculator";

export default async function DraftDatesPage() {
  const guard = await guardPage("draft_date_optimizer");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Draft dates" description="Pick the draft date least likely to bounce." />;
  if (guard.role !== "owner" && guard.role !== "producer") return <RoleGateNotice featureLabel="Draft dates" detail="Owners and producers set draft dates." />;
  return <DraftDateCalculator />;
}
