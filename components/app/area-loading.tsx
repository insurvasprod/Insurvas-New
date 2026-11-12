"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { ShellLoading } from "@/components/app/shell-loading";
import { SettingsRouteLoading } from "@/components/app/settings/settings-route-loading";
import { FRAME_HEADER, StepFrameLayout } from "@/components/app/step-frame/step-frame-layout";
import { leadsInFor, railFor, reportsFrame } from "@/components/app/step-frame/frame-memory";
import { ACCOUNTING_RAIL_COOKIE, ACCOUNTING_STEPS, MY_BALANCE, accountingStepLabel, accountingStepOf } from "@/lib/accounting/steps";
import { COMMISSIONS_RAIL_COOKIE, COMMISSIONS_STEPS, MY_PAY, commissionsStepLabel, commissionsStepOf } from "@/lib/commissions/steps";
import { COMPLIANCE_RAIL_COOKIE, COMPLIANCE_STEPS, complianceStepLabel, complianceStepOf } from "@/lib/compliance/steps";
import { RETENTION_RAIL_COOKIE, RETENTION_STEPS, retentionStepLabel, retentionStepOf } from "@/lib/retention/steps";
import { AREA_COOKIES, DATA_IN_STEPS, areaOfStep, dataInStepLabel, dataInStepOf } from "@/lib/dataIn/steps";
import { REPORTS_RAIL_COOKIE, REPORTS_VIEWS, reportsViewOf } from "@/lib/reports/views";
import { cn } from "@/lib/utils";

/**
 * The loading frame of one area of the app (2026-11-12, "every page opens instantly"): the `loading.tsx` of each
 * top-level area draws this, so a click lands at once on that area's own frame — its title, its tabs' place, its
 * rail — with only the content a skeleton, instead of the shell's one generic skeleton.
 *
 * 1. A step this tab has drawn before (frame-memory.ts): ShellLoading redraws the very rail and title, as it did.
 * 2. A step of a merged page (Book, Carrier sync, Retention, Commissions, Accounting, Compliance, Reports) seen for
 *    the first time: the step's own title on the frame's grid, the rail as a shape. The rail's rows stay shapes —
 *    which steps a person may open is the server's to say, so no names are drawn before it has.
 * 3. A page of its own (Dashboard, Leads, Applications, Partners): its title where it is fixed, its tabs' place,
 *    then PageLoading. Settings draws the Settings frame's shape (SettingsRouteLoading).
 *
 * During a client navigation a loading state renders inside the new route, so `usePathname` is the address opened.
 */
export function AreaLoading() {
  const pathname = usePathname() ?? "";

  // 1. Remembered frames keep their exact rail and title (components/app/shell-loading.tsx).
  if (railFor(pathname) || leadsInFor(pathname) || (reportsViewOf(pathname) && reportsFrame())) return <ShellLoading />;

  // 2. A merged page's step, first time this tab opens that area.
  const merged = mergedStepOf(pathname);
  if (merged) return <MergedFrame {...merged} />;

  // 3. A page of its own.
  if (/^\/app\/settings(\/|$)/.test(pathname)) return <SettingsRouteLoading label="Settings" />;
  const title = FIXED_TITLES[pathname];
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {title ? <PageHeader title={title} tabs={<TabsRoom />} /> : <HeaderShape />}
      <PageLoading header={false} />
    </div>
  );
}

/** Pages whose title is fixed (the same words the page draws); a record under them, or a greeting, is a shape. */
const FIXED_TITLES: Record<string, string> = {
  "/app/leads": "Leads",
  "/app/applications": "Applications",
  "/app/partner-chat": "Partner Chat",
};

type MergedStep = { title: string | null; cookie: string; rows: number };

/** The merged area `pathname` is a step of, in the order the sidebar decides it (agent-sidebar.tsx isActivePath). */
function mergedStepOf(pathname: string): MergedStep | null {
  const exactIn = (hrefs: readonly string[]) => hrefs.includes(pathname);

  const compliance = complianceStepOf(pathname);
  if (compliance) return { title: exactIn(COMPLIANCE_STEPS.map((s) => s.href)) ? complianceStepLabel(compliance) : null, cookie: COMPLIANCE_RAIL_COOKIE, rows: COMPLIANCE_STEPS.length };

  const retention = retentionStepOf(pathname);
  if (retention) return { title: exactIn(RETENTION_STEPS.map((s) => s.href)) ? retentionStepLabel(retention) : null, cookie: RETENTION_RAIL_COOKIE, rows: RETENTION_STEPS.length };

  const commissions = commissionsStepOf(pathname);
  if (commissions) return { title: exactIn([...COMMISSIONS_STEPS.map((s) => s.href), MY_PAY.href]) ? commissionsStepLabel(commissions, pathname) : null, cookie: COMMISSIONS_RAIL_COOKIE, rows: COMMISSIONS_STEPS.length };

  const accounting = accountingStepOf(pathname);
  if (accounting) {
    const own = ACCOUNTING_STEPS.filter((s) => !s.elsewhere);
    return { title: exactIn([...own.map((s) => s.href), MY_BALANCE.href]) ? accountingStepLabel(accounting, pathname) : null, cookie: ACCOUNTING_RAIL_COOKIE, rows: own.length };
  }

  const dataIn = dataInStepOf(pathname);
  if (dataIn) {
    const area = areaOfStep(dataIn);
    return { title: exactIn(DATA_IN_STEPS.map((s) => s.href)) ? dataInStepLabel(dataIn) : null, cookie: AREA_COOKIES[area], rows: DATA_IN_STEPS.filter((s) => s.area === area).length };
  }

  const view = reportsViewOf(pathname);
  if (view) {
    const item = REPORTS_VIEWS.find((entry) => entry.key === view);
    return { title: item && item.href === pathname ? item.label : null, cookie: REPORTS_RAIL_COOKIE, rows: REPORTS_VIEWS.filter((entry) => !entry.offRail).length };
  }
  return null;
}

function MergedFrame({ title, cookie, rows }: MergedStep) {
  const collapsed = useRailCollapsed(cookie);
  return (
    <StepFrameLayout
      stepKey={title ?? "record"}
      busy
      header={title ? <PageHeader title={title} tabs={<TabsRoom />} className={FRAME_HEADER} /> : <HeaderShape className={FRAME_HEADER} />}
      rail={<RailShape collapsed={collapsed} rows={rows} />}
    >
      <PageLoading header={false} />
    </StepFrameLayout>
  );
}

/** The rail's place at its remembered width (StepRail: 248px open, 72px as icons), its rows as shapes. */
function RailShape({ collapsed, rows }: { collapsed: boolean; rows: number }) {
  return (
    <div aria-hidden="true" className={cn("m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col", collapsed ? "lg:w-[72px] lg:px-2" : "lg:w-[248px]")}>
      <div className="flex gap-1 overflow-hidden lg:flex-col">
        {Array.from({ length: Math.min(rows, 8) }).map((_, index) => (
          <div key={index} className={cn("flex shrink-0 items-center gap-3 rounded-xl", collapsed ? "justify-center px-1 py-2" : "px-3 py-2.5")}>
            <span className="size-[18px] shrink-0 m-skel rounded-md" />
            {!collapsed && <span className="h-3 m-skel rounded-full" style={{ width: `${55 + ((index * 23) % 35)}%` }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Whether this area's rail was left as icons (its own cookie, as the page reads it on the server). */
function useRailCollapsed(cookie: string): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      try { return document.cookie.split("; ").some((part) => part === `${cookie}=collapsed`); } catch { return false; }
    },
    () => false,
  );
}
const noSubscribe = () => () => {};

/** The sub-page bar's place while the page loads (as ShellLoading draws it), so the page does not drop. */
function TabsRoom() {
  return (
    <div aria-hidden="true" data-tabs-room="" className="flex h-[2.5rem] flex-1 items-center gap-5 border-b border-border">
      <span className="h-3 w-16 m-skel rounded-full" />
      <span className="h-3 w-20 m-skel rounded-full" />
    </div>
  );
}

/** A title not known yet (a record, a greeting): its shape, as PageLoading draws it. */
function HeaderShape({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex min-h-6 items-center"><div className="h-3 w-32 m-skel rounded-full" /></div>
      <div className="flex min-h-9 items-center"><div className="h-7 w-48 max-w-[60%] m-skel rounded-md" /></div>
    </div>
  );
}
