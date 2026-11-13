import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TrueCpaLeads, TrueCpaLeadsDownload } from "@/components/app/true-cpa-leads";
import { TrueCpaLeadsCharts } from "@/components/app/true-cpa-leads-charts";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { readTrueCpaLeads } from "@/lib/reports/trueCpaLeads";
import { showOf } from "@/lib/reports/show";
import { defaultScorecardPeriod, getVendorScorecardLeads } from "@/lib/vendorScorecard/service";
import { getLeadsBreakdown } from "@/lib/vendorScorecard/series";
import { SCORECARD_STAGES, type ScorecardStage } from "@/lib/vendorScorecard/types";

/**
 * Reports › True CPA › the leads behind a figure (foundation pass 2026-11-03: a page, not a side panel; round 7
 * board 7·7: it opens on the table, and its chart view is where the leads came from and when they arrived).
 * The same gate as True CPA; /api/app/true-cpa/leads applies it again and reads the same scope.
 */
export default async function TrueCpaLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("true_cpa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="True CPA" description="See what each vendor costs per issued policy." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="True CPA" detail="Owners, producers, and bookkeepers can review vendor economics." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="True CPA" detail="In an agency, the owner and admins handle true CPA." />;
  const query = await searchParams;
  const { params: read, title } = readTrueCpaLeads(query);
  // A drill always carries its period; an address without one reads the report's default period.
  const fallback = defaultScorecardPeriod();
  const params: Record<string, string> = { ...read, from: read.from ?? fallback.from, to: read.to ?? fallback.to };
  const info = "The leads behind one True CPA figure, in the report's period and filters. Operational fields only: no phone, SSN or health details. A row opens the lead.";

  if (showOf(query, "table") === "table") {
    return (
      <ReportsPage view="cpa" title={title} info={info} show="table">
        <TrueCpaLeadsDownload params={params} title={title} />
        <TrueCpaLeads params={params} title={title} />
      </ReportsPage>
    );
  }

  // The chart view, drawn on the server from the report (or, for a slot or an attempt, the drill's own rows).
  const stage: ScorecardStage = (SCORECARD_STAGES as readonly string[]).includes(params.stage ?? "") ? params.stage as ScorecardStage : "received";
  const tenantId = guard.context.tenantId;
  const scope = { from: params.from, to: params.to, vendorId: params.vendor_id || null, campaignId: params.campaign_id || null, productCode: params.product_code || null, persistDays: params.persist_days ? Number(params.persist_days) : null };
  const [first, breakdown] = await Promise.all([
    getVendorScorecardLeads(tenantId, { ...scope, stage, slot: params.slot, attemptNumber: params.attempt_number, offset: 0, limit: 1 }).catch(() => null),
    getLeadsBreakdown(tenantId, { ...scope, stage, slot: params.slot || null, attemptNumber: params.attempt_number || null }).catch((error: unknown) => (error instanceof Error ? error.message : "Could not read the leads")),
  ]);
  const total = first?.total ?? null;
  const shownTitle = total != null ? `${title} · ${total.toLocaleString()} ${total === 1 ? "lead" : "leads"}` : title;
  return (
    <ReportsPage view="cpa" title={shownTitle} info={info} show="table">
      <TrueCpaLeadsDownload params={params} title={title} />
      {typeof breakdown === "string"
        ? <TableCard><ErrorState title="The chart did not load" detail={breakdown} /></TableCard>
        : <TrueCpaLeadsCharts params={params} breakdown={breakdown} total={total} noun={stage === "issued" ? "issued leads" : "leads"} />}
    </ReportsPage>
  );
}
