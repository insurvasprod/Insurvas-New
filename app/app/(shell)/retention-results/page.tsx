import { guardPage } from "@/lib/entitlements/guardPage";
import { PERIODS, type Period } from "@/lib/retention/effectiveness";
import { loadEffectiveness } from "@/lib/retention/effectivenessStore";
import { loadRadarConfig } from "@/lib/retention/radarStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionResultsBoard } from "@/components/app/retention/retention-results-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Book › Does it work? (LA-5.9, Notion sprint). From the agency's own book: did the radar's bands come
 * true on the policies nobody worked, and did working the queue beat the holdout? Sample sizes and the
 * period are always stated, and a difference that is not yet meaningful says so. Owner only: it is the
 * whole agency's numbers, and the answer to "is this worth the extra money?".
 */
export default async function RetentionResultsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Does it work?" description="Whether the risk bands came true, and what working the queue saved." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Does it work?" detail="Only the owner sees whether the retention module is earning its price." />;
  }
  const { period: periodParam } = await searchParams;
  const period: Period = periodParam && periodParam in PERIODS ? (periodParam as Period) : "quarter";
  const config = await loadRadarConfig(guard.context.tenantId);
  const data = config ? await loadEffectiveness(guard.context.tenantId, period, config.settings) : null;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Does it work?" description="Whether the radar's predictions came true, and whether working the queue saved policies, from your own book." />
      {data ? (
        <RetentionResultsBoard data={data} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint="Measuring the radar needs a database update (20261016210000)." />
        </TableCard>
      )}
    </div>
  );
}
