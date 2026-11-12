import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TrueCpaWorkspace } from "@/components/app/true-cpa-workspace";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { defaultScorecardPeriod, getVendorScorecard } from "@/lib/vendorScorecard/service";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { sharedPeriod } from "@/lib/reports/views";
import { scopeFromParams, TRUE_CPA_PERSIST_DAYS } from "@/lib/reports/trueCpaView";

export default async function TrueCpaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("true_cpa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="True CPA" description="See what each vendor costs per issued policy." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="True CPA" detail="Owners, producers, and bookkeepers can review vendor economics." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="True CPA" detail="In an agency, the owner and admins handle true CPA." />;
  // LA-2.17-8: the report is rendered with the page, so the figures arrive with the first paint instead of after
  // the shell, hydration and a second request. A failure here is not a failed page: the workspace fetches it
  // itself and shows its own error. Round 7: the scope is in the address (?from&to, the Reports views' shared
  // period, and ?vendor_id&campaign_id&product_code&persist_days, which a chart's bar sets), so the report
  // rendered here is the one the workspace shows.
  const query = await searchParams;
  const period = sharedPeriod(query) ?? defaultScorecardPeriod();
  const scope = scopeFromParams(query, period);
  const initialReport = await getVendorScorecard(guard.context.tenantId, { from: scope.from, to: scope.to, vendorId: scope.vendorId || null, campaignId: scope.campaignId || null, productCode: scope.productCode || null, persistDays: scope.persist ? TRUE_CPA_PERSIST_DAYS : null }, guard.entitlement.access === "read_only").catch(() => null);
  return <ReportsPage view="cpa" show="chart" info="What an issued policy really cost, by vendor and campaign: net spend divided by issued policies. A dash or “No policy yet” means no issued policy, never $0. The funnel starts at the leads received; records bought (lifetime, from each campaign) are not a step. Undialable rate and claim acceptance answer different questions and are never combined into one score."><TrueCpaWorkspace initialReport={initialReport} framed /></ReportsPage>;
}
