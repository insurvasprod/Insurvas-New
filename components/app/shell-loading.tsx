"use client";

import { usePathname } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { StepRail } from "@/components/app/step-frame/step-rail";
import { FRAME_GRID, FRAME_HEADER, FRAME_RAIL_CELL, FRAME_STEP, FRAME_STEP_CELL, StepFrameLayout } from "@/components/app/step-frame/step-frame-layout";
import { leadsInFor, railFor, reportsFrame } from "@/components/app/step-frame/frame-memory";
import { LeadsInRail } from "@/components/app/lead-sources/leads-in-rail";
import type { LeadsInStep } from "@/lib/leadSources/steps";
import { ReportsRail } from "@/components/app/reports/reports-rail";
import { ReportsHeader } from "@/components/app/reports/reports-slot";
import { REPORTS_VIEWS, reportsViewOf } from "@/lib/reports/views";

/**
 * The agent shell's loading state (app/app/(shell)/loading.tsx), drawn between a click and the next page.
 *
 * Opening another step of a merged page (Accounting, Data in, Compliance, Commissions, Reports) is a new route, so
 * it lands here. When the address is a step of a rail this tab has drawn (frame-memory.ts), the same frame is drawn
 * — the step's title, the rail with the step chosen, on StepFrameLayout's grid — and only the step's column is a
 * skeleton (2026-11-08, "feel instant": the title and the rail used to vanish into a whole-page skeleton). Anywhere
 * else it is the one whole-page skeleton, PageLoading.
 *
 * During a client navigation the loading state renders inside the new route, so `usePathname` is the address being
 * opened.
 */
export function ShellLoading() {
  const pathname = usePathname() ?? "";

  const hit = railFor(pathname);
  if (hit) {
    const { rail, step, exact } = hit;
    return (
      <StepFrameLayout
        stepKey={step.key}
        busy
        header={exact ? <PageHeader title={step.label} lead={<TabsRoom />} className={FRAME_HEADER} /> : <HeaderShape />}
        rail={<StepRail label={rail.label} cookie={rail.cookie} countsUrl={rail.countsUrl} waiting={rail.waiting} steps={rail.steps} step={step.key} initialCollapsed={rail.collapsed} foot={rail.foot} />}
      >
        <PageLoading header={false} />
      </StepFrameLayout>
    );
  }

  // Leads in: the same frame its LeadsInPage draws (the step's title, its own menu), the step a skeleton.
  const leads = leadsInFor(pathname);
  if (leads) {
    const { frame, step, exact } = leads;
    return (
      <StepFrameLayout
        stepKey={step.key}
        busy
        header={exact ? <PageHeader title={step.label} lead={<TabsRoom />} className={FRAME_HEADER} /> : <HeaderShape />}
        rail={<LeadsInRail steps={frame.steps as Parameters<typeof LeadsInRail>[0]["steps"]} step={step.key as LeadsInStep} initialCollapsed={frame.collapsed} />}
      >
        <PageLoading header={false} />
      </StepFrameLayout>
    );
  }

  const view = reportsViewOf(pathname);
  const reports = reportsFrame();
  if (view && reports) {
    const exact = REPORTS_VIEWS.some((item) => item.key === view && item.href === pathname);
    const body = (
      <>
        <div className={FRAME_RAIL_CELL}><ReportsRail view={view} initialCollapsed={reports.collapsed} /></div>
        <div className={FRAME_STEP_CELL}>
          <div key={view} data-page-content aria-busy className={FRAME_STEP}><PageLoading header={false} /></div>
        </div>
      </>
    );
    return (
      <div data-step-frame className={FRAME_GRID}>
        {exact
          ? <ReportsHeader title={REPORTS_VIEWS.find((item) => item.key === view)!.label}>{body}</ReportsHeader>
          : <><HeaderShape />{body}</>}
      </div>
    );
  }

  return <PageLoading />;
}

/** Holds the height of the tabs that most steps draw on the title's line, so the step does not drop when they arrive. */
function TabsRoom() {
  return <span aria-hidden="true" className="block h-9" />;
}

/** A page under a step (a record): its title is not known yet, so its shape, as PageLoading draws it. */
function HeaderShape() {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-1.5 ${FRAME_HEADER}`}>
      <div className="flex min-h-6 items-center"><div className="h-3 w-32 m-skel rounded-full" /></div>
      <div className="flex min-h-9 items-center"><div className="h-7 w-48 max-w-[60%] m-skel rounded-md" /></div>
    </div>
  );
}
