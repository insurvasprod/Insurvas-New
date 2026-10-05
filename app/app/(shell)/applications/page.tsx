import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ApplicationsList } from "@/components/app/applications/applications-list";
import { SetupPending } from "@/components/app/applications/setup-pending";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { FIXTURE_APPLICATIONS } from "@/lib/applications/fixtures";
import { ApplicationError } from "@/lib/applications/db";
import { listApplicationRows } from "@/lib/applications/lists";

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
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Applications" description="Take a sale from the health interview to the carrier's policy number in one place." />;
  if (guard.role !== "owner" && guard.role !== "producer") return <RoleGateNotice featureLabel="Applications" detail="Owners and producers work applications." />;
  const query = await searchParams;
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") return <ApplicationsList rows={FIXTURE_APPLICATIONS} sample />;
  const [rows, timeZone] = await Promise.all([orPending(listApplicationRows(guard.context.tenantId)), getWorkspaceTimezone(guard.context.tenantId).catch(() => null)]);
  if (!rows) return <SetupPending title="Applications" />;
  return <ApplicationsList rows={rows} timeZone={timeZone ?? undefined} />;
}
