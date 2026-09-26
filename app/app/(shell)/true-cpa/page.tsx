import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TrueCpaWorkspace } from "@/components/app/true-cpa-workspace";
import { guardPage } from "@/lib/entitlements/guardPage";
import { sectionForPath } from "@/lib/menu/definition";
import { getVendorScorecard } from "@/lib/vendorScorecard/service";

export default async function TrueCpaPage() {
  const guard = await guardPage("true_cpa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="True CPA" description="See what each vendor and campaign actually costs through an issued policy." eyebrow={sectionForPath("/app/true-cpa") ?? undefined} />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="True CPA" detail="Owners, producers, and bookkeepers can review vendor economics." eyebrow={sectionForPath("/app/true-cpa") ?? undefined} />;
  // LA-2.17-8: the default period's report is rendered with the page, so the figures arrive with the
  // first paint instead of after the shell, hydration and a second request. A failure here is not a
  // failed page: the workspace fetches it itself and shows its own error.
  const initialReport = await getVendorScorecard(guard.context.tenantId, {}, guard.entitlement.access === "read_only").catch(() => null);
  return <TrueCpaWorkspace initialReport={initialReport} />;
}
