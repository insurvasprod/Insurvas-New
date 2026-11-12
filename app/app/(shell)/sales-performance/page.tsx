import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { SalesPerformance } from "@/components/app/applications/sales-performance";
import { SetupPending } from "@/components/app/applications/setup-pending";
import { StatusChip } from "@/components/ui/status-chip";
import { ApplicationError } from "@/lib/applications/db";
import { loadSalesReport } from "@/lib/applications/report";
import { sampleReportInput } from "@/lib/applications/reportFixtures";
import { buildSalesReport, defaultWindow, salesFiltersOf } from "@/lib/applications/reportRules";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { sharedPeriod } from "@/lib/reports/views";

/** The page's data, or null while its migration is not applied. */
async function orPending<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return null;
    throw error;
  }
}

/** The view's (i) (foundation pass 2026-11-03): what the report counts, once, beside the title. */
const INFO = "Where applications stop, by carrier and reason. Every rate is read from the two numbers in its tooltip; a rate waits for 5 cases. Placed is partial: it is never inferred from issued.";

/**
 * Round 7 (owner pick 1·B + 1·A as bars, 2026-11-11): the Table · Chart switch on the title line, opening on the
 * chart. The filters ride in the address (`?carrier&product&source&producer`, with the shared `?from&to`), so a
 * chart's bar opens the table filtered to its rows; the view remounts on a new read so it starts from these figures.
 */
export default async function SalesPerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("sales_report");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Sales performance" description="Where cases drop, and which carriers decline what." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Sales performance" detail="Owners, producers and bookkeepers can review sales performance." />;
  const query = await searchParams;
  const filters = salesFiltersOf(query);
  // The Reports views' shared period (?from&to), when another view (or a chart's week) set one.
  const period = sharedPeriod(query);
  const readKey = [period?.from, period?.to, filters.carrierId, filters.productCode, filters.source, filters.producerId].join("|");
  const scoped = { carrierId: filters.carrierId || null, productCode: filters.productCode || null, source: filters.source || null, producerId: filters.producerId || null };
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line react-hooks/purity -- a server render: the sample is dated as of this request.
    const now = Date.now();
    const window = period ?? defaultWindow(now, "UTC");
    return <ReportsPage view="sales" info={INFO} show="chart" chip={<StatusChip tone="info">Sample</StatusChip>}><SalesPerformance key={readKey} report={buildSalesReport(sampleReportInput(now), { ...window, ...scoped })} initialFilters={filters} sample framed /></ReportsPage>;
  }
  const loaded = await orPending(scopeFor(guard.context).then((scope) => loadSalesReport(guard.context.tenantId, { ...(period ?? {}), ...scoped }, undefined, scope)));
  if (!loaded) return <SetupPending title="Sales performance" />;
  return <ReportsPage view="sales" info={INFO} show="chart"><SalesPerformance key={readKey} report={loaded.report} initialFilters={filters} timeZone={loaded.timeZone} framed periodFromAddress={Boolean(period)} /></ReportsPage>;
}
