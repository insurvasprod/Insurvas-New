import { scopeFor } from "@/lib/agency/visibility";
import { guardPage } from "@/lib/entitlements/guardPage";
import { canWrite } from "@/lib/entitlements/types";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PendingCases, type PendingTab } from "@/components/app/applications/pending-cases";
import { SetupPending } from "@/components/app/applications/setup-pending";
// LA-8.2: times show in the viewer's own display timezone, else the agency's.
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { ApplicationError } from "@/lib/applications/db";
import { FIXTURE_AWAITING_NUMBER, FIXTURE_COUNTEROFFERS, FIXTURE_PENDING_ALL } from "@/lib/applications/listFixtures";
import { loadPending } from "@/lib/applications/pending";
import { DEFAULT_SALES_SETTINGS } from "@/lib/salesSettings/schema";

const TABS: readonly PendingTab[] = ["requirements", "counteroffers", "awaiting"];

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

/** The page's data, or null while its migration is not applied. */
async function orPending<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return null;
    throw error;
  }
}

export default async function PendingCasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("applications");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Pending cases" description="What each submitted case is waiting on." />;
  if (guard.role !== "owner" && guard.role !== "producer") return <RoleGateNotice featureLabel="Pending cases" detail="Owners and producers work pending cases." />;
  const query = await searchParams;
  const tab = single(query.tab);
  const initialTab = TABS.find((key) => key === tab) ?? "requirements";
  const readOnly = !canWrite(guard.entitlement);
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") {
    return <PendingCases requirements={FIXTURE_PENDING_ALL} counteroffers={FIXTURE_COUNTEROFFERS} awaiting={FIXTURE_AWAITING_NUMBER} ageingDays={DEFAULT_SALES_SETTINGS.requirementAgeingDays} initialTab={initialTab} readOnly={readOnly} sample />;
  }
  const [data, timeZone] = await Promise.all([orPending(scopeFor(guard.context).then((scope) => loadPending(guard.context.tenantId, undefined, scope))), getViewerTimezone(guard.context.tenantId, guard.context.userId).catch(() => null)]);
  if (!data) return <SetupPending title="Pending cases" />;
  return <PendingCases requirements={data.requirements} counteroffers={data.counteroffers} awaiting={data.awaiting} ageingDays={data.ageingDays} initialTab={initialTab} readOnly={readOnly} timeZone={timeZone ?? undefined} />;
}
