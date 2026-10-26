import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DraftDateCalculator } from "@/components/app/applications/draft-dates/draft-date-calculator";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/entitlements/types";

export default async function DraftDatesPage() {
  const guard = await guardPage("draft_date_optimizer");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Draft dates" description="Pick the draft date least likely to bounce." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Draft dates" detail="Owners and producers set draft dates." />;
  // The calculator is a tool on Applications now (2026-10-26): it opens there, over the Cases tab. Without
  // the applications feature there is no Applications page, so it stays a page of its own.
  if (hasFeature(guard.entitlement, "applications")) redirect("/app/applications?calculator=1");
  return <DraftDateCalculator />;
}
