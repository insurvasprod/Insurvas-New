import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { ReportsRail } from "@/components/app/reports/reports-rail";
import { ReportsHeader } from "@/components/app/reports/reports-slot";
import { REPORTS_RAIL_COOKIE, reportsViewLabel, type ReportsView } from "@/lib/reports/views";

/**
 * Reports in one page (owner 2026-10-30, canvas "Reports in one page"): Sales performance, Team
 * activity, Queue scoring, Book scorecards, True CPA and Partner quality are one page — six views down a
 * menu on the left, the view on the right — built the way Leads in is (components/app/lead-sources/leads-in.tsx).
 *
 * Each view keeps its own address and its own route's gate (`/app/sales-performance`, `/app/activity`,
 * `/app/scoring`, `/app/book-scorecards`, `/app/true-cpa`, `/app/partner-quality`), so every old link,
 * bookmark and guide target still lands on the right screen; the route renders its screen inside this
 * frame. The menu offers the Reports pages the sidebar offers this person.
 *
 * `title`: the record a drill or a sub-page has open (a scorecard's rows), in place of the view's name.
 * `bar`: the view puts its own tabs or actions in the top row (ReportsSlot), so the row is held open on
 * the first paint rather than pushing the view down once they arrive.
 */
export async function ReportsPage({ view, title, bar = true, children }: { view: ReportsView; title?: string; bar?: boolean; children: ReactNode }) {
  const jar = await cookies();
  const collapsed = jar.get(REPORTS_RAIL_COOKIE)?.value === "collapsed";

  return (
    // The title and trail across the top, 24px over the content; then the rail and the view's column,
    // starting on one line. The view scrolls inside its own column; the page never does (lg and up).
    // One column under lg: minmax(0,1fr), or the rail's row of chips would stretch it past the phone's width.
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)] lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-[min-content_minmax(0,1fr)] lg:gap-y-0">
      <ReportsHeader title={title ?? reportsViewLabel(view)}>
        <div className="lg:col-start-1 lg:row-start-2 lg:min-h-0">
          <ReportsRail view={view} initialCollapsed={collapsed} />
        </div>
        <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-start-2 lg:min-h-0">
          <div className={`flex flex-none flex-wrap items-center gap-3 pb-4 ${bar ? "" : "hidden"}`}>
            <div id="reports-lead" className="flex min-h-[2.25rem] min-w-0 flex-1 flex-wrap items-center gap-2" />
            <div id="reports-corner" className="ml-auto flex items-center gap-2" />
          </div>
          {/* The view rises in on every switch; rows, figures and bars bring their own motion. */}
          {/* [&>*]:shrink-0: a view's own wrapper never gives up height to the scroll box (a StatStrip squeezed to a line). */}
          <div key={view} className="flex min-w-0 flex-col gap-6 [&>*]:shrink-0 motion-safe:animate-[m-rise_.38s_cubic-bezier(.2,.8,.2,1)_both] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {children}
          </div>
        </div>
      </ReportsHeader>
    </div>
  );
}
