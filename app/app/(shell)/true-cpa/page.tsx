import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TrueCpaWorkspace } from "@/components/app/true-cpa-workspace";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { getVendorScorecard } from "@/lib/vendorScorecard/service";
import { DashboardStage } from "@/components/ui/dashboard-stage";

export default async function TrueCpaPage() {
  const guard = await guardPage("true_cpa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="True CPA" description="See what each vendor costs per issued policy." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="True CPA" detail="Owners, producers, and bookkeepers can review vendor economics." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="True CPA" detail="In an agency, the owner and admins handle true CPA." />;
  // LA-2.17-8: the default period's report is rendered with the page, so the figures arrive with the
  // first paint instead of after the shell, hydration and a second request. A failure here is not a
  // failed page: the workspace fetches it itself and shows its own error.
  const initialReport = await getVendorScorecard(guard.context.tenantId, {}, guard.entitlement.access === "read_only").catch(() => null);
  return <DashboardStage ribbon><TrueCpaWorkspace initialReport={initialReport} /></DashboardStage>;
}
