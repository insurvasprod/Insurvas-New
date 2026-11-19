import { Suspense } from "react";

import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLoading } from "@/components/ui/page-states";
import { ViewTabs } from "@/components/ui/view-tabs";
import { CustomersTab } from "@/components/admin/dashboard/customers-tab";
import { HealthTab } from "@/components/admin/dashboard/health-tab";
import { MoneyTab } from "@/components/admin/dashboard/money-tab";
import { NeedsTab } from "@/components/admin/dashboard/needs-tab";
import { PeriodSwitch } from "@/components/admin/dashboard/ov-period";
import { OVERVIEW_FALLBACK } from "@/components/admin/dashboard/ov-graphs";
import { OverviewTab, overviewHasGraphs } from "@/components/admin/dashboard/overview-tab";
import { SecurityTab } from "@/components/admin/dashboard/security-tab";
import type { DashboardAdmin } from "@/components/admin/dashboard/types";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { DASH_PERIODS } from "@/lib/adminDashboard/periods";
import { ADMIN_DASHBOARD_TAB_LABELS, dashboardTabHref, dashboardTabsFor, pickDashboardTab, type AdminDashboardTab } from "@/lib/adminDashboard/tabs";

/**
 * The staff home (admin round 1, owner 2026-11-17: "the first one should be all graphs, then all the sub pages of
 * everything that an admin needs to see"; docs/design/admin-r1/dashboard-combined.html). Title and tabs on one line
 * (Overview's period filter at its right; no status line under it, owner 2026-11-18), then the tab: Overview (graphs), Needs you (the daily checks as a work
 * queue), Money, Customers, Platform health, Security & staff. The tab lives in the address (?tab=), and a role is
 * offered only the tabs whose pages it can open (lib/adminDashboard/tabs.ts).
 */

type Search = { tab?: string };

/** A server render reads the clock once per request, which is the point. */
function readClock() {
  return new Date().toISOString();
}

function TabLoading() {
  return <SectionLoading rows={6} columns={4} label="Loading the dashboard" />;
}

function TabBody({ tab, admin }: { tab: AdminDashboardTab; admin: DashboardAdmin }) {
  if (tab === "needs") return <NeedsTab admin={admin} />;
  if (tab === "money") return <MoneyTab admin={admin} />;
  if (tab === "customers") return <CustomersTab admin={admin} />;
  if (tab === "health") return <HealthTab admin={admin} />;
  if (tab === "security") return <SecurityTab admin={admin} />;
  return <OverviewTab admin={admin} />;
}

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [current, query] = await Promise.all([getCurrentAdmin(), searchParams]);
  if (!current) return null; // the (protected) layout has already sent a signed-out visitor to /admin/login
  const admin: DashboardAdmin = { id: current.id, role: current.role };
  const tab = pickDashboardTab(admin.role, query.tab);
  const tabs = dashboardTabsFor(admin.role).map((key) => ({ key, label: ADMIN_DASHBOARD_TAB_LABELS[key], href: dashboardTabHref(key) }));

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-3">
      <PageHeader
        title="Dashboard"
        description="The platform at a glance: graphs first, then one tab for each thing an admin watches. Every figure opens the rows behind it."
        tabs={<ViewTabs label="Dashboard views" value={tab} tabs={tabs} />}
        actions={
          <>
            <LiveStamp updatedAt={readClock()} />
            {tab === "overview" && overviewHasGraphs(admin.role) && <PeriodSwitch periods={DASH_PERIODS} fallback={OVERVIEW_FALLBACK} label="Graph period" />}
          </>
        }
      />
      <Suspense key={tab} fallback={<TabLoading />}>
        <TabBody tab={tab} admin={admin} />
      </Suspense>
    </div>
  );
}
