import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ApplicationsList } from "@/components/app/applications/applications-list";
import { SetupPending } from "@/components/app/applications/setup-pending";
// LA-8.2: times show in the viewer's own display timezone, else the agency's.
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { FIXTURE_APPLICATIONS } from "@/lib/applications/fixtures";
import { ApplicationError } from "@/lib/applications/db";
import { listApplicationRows } from "@/lib/applications/lists";
import { ApplicationsHub } from "@/components/app/applications/applications-hub";
import { applicationsTabs, hasCalculator } from "@/components/app/applications/applications-tabs";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { canWrite } from "@/lib/entitlements/types";

/** The page's data, or null while its migration is not applied. */
async function orPending<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return null;
    throw error;
  }
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("applications");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Applications" description="From health interview to policy number, in one place." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Applications" detail="Owners and producers work applications." />;
  const query = await searchParams;
  // One page with Pending cases, Quotes and Draft dates (2026-10-26): this is its Cases tab.
  const hub = (body: React.ReactNode) => <DashboardStage ribbon><ApplicationsHub view="cases" tabs={applicationsTabs(guard.entitlement)} calculator={hasCalculator(guard.entitlement)} readOnly={!canWrite(guard.entitlement)} calculatorOpen={query.calculator === "1" && hasCalculator(guard.entitlement)}>{body}</ApplicationsHub></DashboardStage>;
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") return hub(<ApplicationsList rows={FIXTURE_APPLICATIONS} sample embedded />);
  const [rows, timeZone] = await Promise.all([orPending(scopeFor(guard.context).then((scope) => listApplicationRows(guard.context.tenantId, scope))), getViewerTimezone(guard.context.tenantId, guard.context.userId).catch(() => null)]);
  if (!rows) return <SetupPending title="Applications" />;
  return hub(<ApplicationsList rows={rows} timeZone={timeZone ?? undefined} embedded />);
}
