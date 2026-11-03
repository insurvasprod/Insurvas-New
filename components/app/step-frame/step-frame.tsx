import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { StepRail, type RailStep, type RailWaiting } from "@/components/app/step-frame/step-rail";

/**
 * The frame of a merged page (Data in and Accounting, 2026-11-02; the Compliance and Reports layout): the
 * page's title and trail across the top; then the rail standing the full height on the left and, on the
 * right, the step's own row (`lead`: its tabs; `actions`: its one primary) over the step, which scrolls
 * inside itself so every part of it is reachable without the page moving.
 *
 * The caller decides which steps this person may open — each by the rule its own route applies — and
 * reads the rail's collapsed cookie; this only draws.
 */
export function StepFrame({ title, titleInfo, rail, lead, actions, children }: {
  title: string;
  /** An (i) beside the title, for a word the page cannot do without (Statements: what a carrier statement is). */
  titleInfo?: ReactNode;
  rail: { label: string; cookie: string; countsUrl?: string; waiting?: RailWaiting; steps: RailStep[]; step: string; collapsed: boolean };
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    // One column on a phone (minmax(0,1fr), so the rail's chip row scrolls instead of widening the page).
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)] lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-[min-content_minmax(0,1fr)] lg:gap-y-0">
      <PageHeader title={title} titleInfo={titleInfo} className="lg:col-span-2 lg:pb-6" />
      <div className="lg:col-start-1 lg:row-start-2 lg:min-h-0">
        <StepRail label={rail.label} cookie={rail.cookie} countsUrl={rail.countsUrl} waiting={rail.waiting} steps={rail.steps} step={rail.step} initialCollapsed={rail.collapsed} />
      </div>
      <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-start-2 lg:min-h-0">
        {(lead || actions) && (
          <div className="flex flex-none flex-wrap items-center gap-3 pb-4">
            <div className="flex min-h-[2.25rem] min-w-0 flex-1 flex-wrap items-center gap-2">{lead}</div>
            {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
          </div>
        )}
        {/* Its blocks keep their height (a strip is never squeezed); the column scrolls, never the page. */}
        <div key={rail.step} className="flex min-w-0 flex-col gap-6 [&>*]:shrink-0 motion-safe:animate-[m-rise_.38s_cubic-bezier(.2,.8,.2,1)_both] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {children}
        </div>
      </div>
    </div>
  );
}
