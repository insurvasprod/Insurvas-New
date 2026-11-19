import { Suspense } from "react";
import { redirect } from "next/navigation";

import { WsPanelLoading } from "@/components/admin/billing/ws-panel";
import { GraphCardLoading } from "@/components/admin/dashboard/ov-card";
import { MonitoringPage } from "@/components/admin/monitoring/monitoring-page";
import { readMonitoringClock, WsFigures, WsFiguresLoading, WsJobs, WsLatest, WsSignInChart, WsWorth } from "@/components/admin/monitoring/ws-sections";
import { PeriodMenu } from "@/components/ui/period-menu";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { chartDays, parseWorkspaceRange, WORKSPACE_RANGES } from "@/lib/adminMonitoring/workspace";
import { canSeeSignIns } from "@/lib/adminMonitoring/workspaceQueries";

/**
 * Admin › Monitoring workspace (admin round 1, docs/design/admin-r1/monitoring.html screen 1): what's unusual right
 * now across sign-ins, staff actions and jobs. Any admin; each part shows only what the role may open (sign-ins for
 * a role that can open Login activity, lockouts for a super admin, staff actions under the audit log's own-actions
 * rule). The range (Today · 7 days · 30 days) is a filter button on the title line's right (owner 2026-11-18) and
 * lives in the address (`?range=`). Each part streams and fails on its own; the rail and the title show at once.
 */
export default async function MonitoringWorkspacePage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const range = parseWorkspaceRange((await searchParams).range);
  const viewer = { id: admin.id, role: admin.role };
  const signIns = canSeeSignIns(admin.role);
  const key = `${range}`;
  const now = readMonitoringClock();

  return (
    <MonitoringPage
      step="workspace"
      title="Monitoring"
      info="What's unusual right now, across sign-ins, staff actions and jobs. Each item opens its page, filtered. Times are UTC."
      actions={
        <PeriodMenu
          label="Range"
          value={range}
          options={WORKSPACE_RANGES.map((item) => ({ key: item.key, label: item.label, href: item.key === "today" ? "/admin/monitoring" : `/admin/monitoring?range=${item.key}` }))}
        />
      }
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <Suspense key={`figures-${key}`} fallback={<WsFiguresLoading />}>
          <WsFigures viewer={viewer} range={range} now={now} />
        </Suspense>
        <div className={signIns ? "grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]" : "grid min-w-0 gap-4"}>
          {signIns && (
            <Suspense key={`chart-${key}`} fallback={<GraphCardLoading title={`Sign-ins · ${chartDays(range)} days`} />}>
              <WsSignInChart viewer={viewer} range={range} now={now} />
            </Suspense>
          )}
          <Suspense key={`worth-${key}`} fallback={<WsPanelLoading title="Worth a look" rows={3} />}>
            <WsWorth viewer={viewer} range={range} now={now} />
          </Suspense>
        </div>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Suspense fallback={<WsPanelLoading title="Jobs failing" rows={3} />}>
            <WsJobs viewer={viewer} />
          </Suspense>
          <Suspense key={`latest-${key}`} fallback={<WsPanelLoading title={admin.role === "super_admin" ? "Latest staff actions" : "Your latest actions"} rows={4} />}>
            <WsLatest viewer={viewer} range={range} now={now} />
          </Suspense>
        </div>
      </div>
    </MonitoringPage>
  );
}
