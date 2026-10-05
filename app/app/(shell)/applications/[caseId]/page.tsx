import { Suspense } from "react";
import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ApplicationWorkspace } from "@/components/app/applications/workspace/application-workspace";
import { SetupPending } from "@/components/app/applications/setup-pending";
import { FIXTURE_CASE } from "@/lib/applications/fixtures";
import { ApplicationError } from "@/lib/applications/db";
import { isUuid } from "@/lib/applications/http";
import { getCaseView } from "@/lib/applications/service";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";

/**
 * /app/applications/[caseId] — the workspace, on the real case. `?preview=sample` renders the design
 * fixtures instead, outside production only, so the screens can be reviewed before data exists.
 */
export default async function ApplicationWorkspacePage({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("applications");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Applications" description="Take a sale from the health interview to the carrier's policy number in one place." />;
  if (guard.role !== "owner" && guard.role !== "producer") return <RoleGateNotice featureLabel="Applications" detail="Owners and producers work applications." />;
  const [{ caseId }, query] = await Promise.all([params, searchParams]);

  if (query.preview === "sample" && process.env.NODE_ENV !== "production") {
    return <Suspense><ApplicationWorkspace initial={FIXTURE_CASE} sample /></Suspense>;
  }
  if (!isUuid(caseId)) notFound();
  let view: Awaited<ReturnType<typeof getCaseView>>;
  // The agency's zone, so the workspace prints times as the Applications list does (and the server
  // render matches the browser's).
  const zone = getWorkspaceTimezone(guard.context.tenantId).catch(() => null);
  try {
    view = await getCaseView(guard.context.tenantId, caseId);
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "CASE_NOT_FOUND") notFound();
    if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return <SetupPending title="Application" />;
    throw error;
  }
  const timeZone = (await zone) ?? undefined;
  return <Suspense><ApplicationWorkspace initial={view} sample={false} timeZone={timeZone} /></Suspense>;
}
