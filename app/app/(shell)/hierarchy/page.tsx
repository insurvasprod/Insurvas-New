import { Suspense } from "react";
import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { HierarchyBoard } from "@/components/app/agency/hierarchy-board";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { FramedLoading } from "@/components/app/reports/reports-slot";
import { readOverrideReport } from "@/lib/agency/overrideStore";
import { HIERARCHY_PATH, monthOptions, monthParam, thisMonth } from "@/lib/agency/hierarchyView";
import { showHref } from "@/lib/reports/show";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";

/**
 * AG-1.2 · Reports › Hierarchy & overrides (owner 2026-11-05: "Put hierarchy and overrides on reports"). Owner, admin,
 * bookkeeper; a manager sees his reports (the store's scopeFor). Reports round 7 (owner pick 6 · B and C, 2026-11-11):
 * the "Table · Chart" switch (`?show=`, chart first), the month on the title line (`?month=2026-11`), and the tabs
 * All · Missing levels · Negative spreads (`?tab=`). The rows and the six months behind the charts are read here, on
 * the server, and stream in under the frame. The old `?issues=1` (the agency dashboard's "levels to fix") lands on
 * the table's Missing levels tab.
 */
export default async function HierarchyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Hierarchy & Overrides" description="Who reports to whom, and what the agency keeps on each producer." />;
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || guard.context.memberRole === "manager")) {
    return <RoleGateNotice featureLabel="Hierarchy & Overrides" detail="The owner, admins, managers and the bookkeeper see overrides." />;
  }
  const query = await searchParams;
  if (query.issues === "1") redirect(showHref(HIERARCHY_PATH, "table", { tab: "missing" }));
  const month = monthParam(query.month);
  const readOnly = guard.entitlement.access === "read_only";
  const isOwner = guard.role === "owner";
  return (
    <ReportsPage
      view="hierarchy"
      show="chart"
      info="Who reports to whom, and what the agency keeps on each producer's business in the month. The override is computed (agency level minus the producer's level, per carrier, on what the carriers' statements said), never typed. A missing level means no override until it is set; a negative spread means the agency pays out more than it receives."
    >
      <Suspense key={month} fallback={<FramedLoading />}>
        <HierarchyData context={guard.context} month={month} isOwner={isOwner} readOnly={readOnly} />
      </Suspense>
    </ReportsPage>
  );
}

async function HierarchyData({ context, month, isOwner, readOnly }: { context: TenantContext; month: string; isOwner: boolean; readOnly: boolean }) {
  let report: Awaited<ReturnType<typeof readOverrideReport>> | null = null;
  let error: string | null = null;
  try {
    report = await readOverrideReport(context, month);
  } catch (cause) {
    console.error("[hierarchy page]", cause instanceof Error ? cause.message : cause);
    error = "Hierarchy and overrides could not be read. Try again in a moment.";
  }
  return (
    <HierarchyBoard
      rows={report?.rows ?? []}
      trend={report?.trend ?? []}
      month={month}
      currentMonth={thisMonth()}
      months={monthOptions()}
      canChangeManager={isOwner}
      readOnly={readOnly}
      canEdit={isOwner && !readOnly}
      error={error}
    />
  );
}
