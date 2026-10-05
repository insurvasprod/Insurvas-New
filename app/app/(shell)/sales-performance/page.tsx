import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { SalesPerformance } from "@/components/app/applications/sales-performance";
import { SetupPending } from "@/components/app/applications/setup-pending";
import { ApplicationError } from "@/lib/applications/db";
import { loadSalesReport } from "@/lib/applications/report";
import { sampleReportInput } from "@/lib/applications/reportFixtures";
import { buildSalesReport, defaultWindow } from "@/lib/applications/reportRules";

/** The page's data, or null while its migration is not applied. */
async function orPending<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return null;
    throw error;
  }
}

export default async function SalesPerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("sales_report");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Sales performance" description="See where cases drop between quote and placed policy, and which carriers decline what." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Sales performance" detail="Owners, producers and bookkeepers can review sales performance." />;
  const query = await searchParams;
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line react-hooks/purity -- a server render: the sample is dated as of this request.
    const now = Date.now();
    return <SalesPerformance report={buildSalesReport(sampleReportInput(now), defaultWindow(now, "UTC"))} sample />;
  }
  const loaded = await orPending(loadSalesReport(guard.context.tenantId));
  if (!loaded) return <SetupPending title="Sales performance" />;
  return <SalesPerformance report={loaded.report} timeZone={loaded.timeZone} />;
}
