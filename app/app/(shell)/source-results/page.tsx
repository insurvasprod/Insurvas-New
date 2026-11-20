import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await } from "@/components/app/reports/await";
import { LeadSourcesBody, LeadSourcesStrip, LeadSourcesTabs, LeadSourcesUnavailable } from "@/components/app/reports/lead-sources-report";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { StreamSection } from "@/components/ui/stream-section";
import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature } from "@/lib/entitlements/types";
import { leadSourcesHref, leadSourcesTabOf } from "@/lib/reports/leadSourcesView";
import { showHref, showOf } from "@/lib/reports/show";
import { sharedPeriod } from "@/lib/reports/views";
import { getScorecardSeries } from "@/lib/vendorScorecard/series";
import { defaultScorecardPeriod, getVendorScorecard } from "@/lib/vendorScorecard/service";

const INFO = "What each vendor's and campaign's leads became in the period: dialed, contacted, applied and issued, with the median time to the first dial and the consent stored, from the same report as True CPA. A rate waits for 20 leads; under it the two counts show. Spend and cost a lead show only with True CPA on your plan.";

/**
 * Reports › Lead sources (owner 2026-11-19: "more reports, since there are more modules available for Basic").
 * Vendors and campaigns' gate and roles (/app/campaigns: outbound_dialing, owner and producer); inside an agency the
 * owner's and admins' only, like True CPA (AG-0.5). Money only with True CPA (a campaign page's rule). Frame first
 * (§7a): the report and its weekly series are started here and stream in under the title, the rail and the switch.
 */
export default async function LeadSourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead sources" description="What each vendor and campaign's leads became: contacted, applied, issued." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Lead sources" detail="Owners and producers can review lead sources." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead sources" detail="In an agency, the owner and admins review lead sources." />;

  const query = await searchParams;
  const period = sharedPeriod(query) ?? defaultScorecardPeriod();
  const tab = leadSourcesTabOf(Array.isArray(query.tab) ? query.tab[0] : query.tab);
  const show = showOf(query, "chart");
  const trueCpa = hasFeature(guard.entitlement, "true_cpa");
  const money = trueCpa;
  const tableHref = showHref(leadSourcesHref(tab, period), "table");
  const tenantId = guard.context.tenantId;

  const report = getVendorScorecard(tenantId, { from: period.from, to: period.to }, guard.entitlement.access === "read_only").catch((cause) => {
    console.error("[lead sources]", cause instanceof Error ? cause.message : cause);
    return null;
  });
  // The cards' small charts: the same report a week at a time (at most 13 reads, four at once). A failure only drops the lines.
  const series = getScorecardSeries(tenantId, { from: period.from, to: period.to }).catch(() => null);
  const strip = Promise.all([report, series]);

  return (
    <ReportsPage view="sources" info={INFO} show="chart">
      <LeadSourcesTabs tab={tab} period={period} show={show} />
      <StreamSection shape="strip">
        <Await read={strip}>
          {([read, points]) => (read ? <LeadSourcesStrip report={read} series={points} money={money} trueCpa={trueCpa} period={period} tableHref={tableHref} /> : null)}
        </Await>
      </StreamSection>
      <StreamSection shape="table">
        <Await read={report}>
          {(read) => (read
            ? <LeadSourcesBody report={read} tab={tab} show={show} money={money} period={period} tableHref={tableHref} />
            : <LeadSourcesUnavailable period={period} />)}
        </Await>
      </StreamSection>
    </ReportsPage>
  );
}
