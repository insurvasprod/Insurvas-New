import { guardPage } from "@/lib/entitlements/guardPage";
import { PERIODS, type Period } from "@/lib/retention/effectiveness";
import { loadEffectiveness, readEffectiveness } from "@/lib/retention/effectivenessStore";
import { loadRadarConfig } from "@/lib/retention/radarStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionResultsBoard } from "@/components/app/retention/retention-results-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ReportsPage } from "@/components/app/reports/reports-page";

/**
 * Reports › Retention results (LA-5.9, Notion sprint). From the agency's own book: did the radar's bands come
 * true on the policies nobody worked, and did working the queue beat the holdout? Sample sizes and the
 * period are always stated, and a difference that is not yet meaningful says so. Owner only: it is the
 * whole agency's numbers, and the answer to "is this worth the extra money?".
 */
export default async function RetentionResultsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Retention results" description="Whether the risk bands came true, and what working the queue saved." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Retention results" detail="Only the owner sees whether the retention module is earning its price." />;
  }
  const { period: periodParam } = await searchParams;
  const period: Period = periodParam && periodParam in PERIODS ? (periodParam as Period) : "quarter";
  // The figures need no settings to be read, so they are read beside the config (one round trip, not two);
  // the no-op catch only stops a failure counting as unhandled when there is no config to use them.
  const reads = readEffectiveness(guard.context.tenantId);
  reads.catch(() => undefined);
  const config = await loadRadarConfig(guard.context.tenantId);
  const data = config ? await loadEffectiveness(guard.context.tenantId, period, config.settings, reads) : null;

  return (
    <ReportsPage view="retentionResults" info="From your own book: did the radar's bands come true on the policies nobody worked, and did working the queue beat the holdout? Under 20 policies a cell shows the count, never a percentage, and a difference that is not yet meaningful says so.">
    <>
      {data ? (
        <RetentionResultsBoard data={data} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint="Measuring the radar needs a database update (20261016210000)." />
        </TableCard>
      )}
    </>
    </ReportsPage>
  );
}
