import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { ReportsRail } from "@/components/app/reports/reports-rail";
import { ReportsHeader } from "@/components/app/reports/reports-slot";
import { FRAME_GRID, FRAME_RAIL_CELL, FRAME_STEP, FRAME_STEP_CELL } from "@/components/app/step-frame/step-frame-layout";
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
 * `bar`: accepted and ignored (2026-11-02): a view's tabs and actions (ReportsSlot) sit on the title's line.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md), as Accounting: `info` is the view's (i)
 * (what used to be a sentence over a table); a record under a view (a drill, an agent, a partner) passes
 * its `title`, its status `chip` and one muted line of `facts`.
 */
export async function ReportsPage({ view, title, info, chip, facts, children }: { view: ReportsView; title?: string; info?: ReactNode; chip?: ReactNode; facts?: ReactNode; bar?: boolean; children: ReactNode }) {
  const jar = await cookies();
  const collapsed = jar.get(REPORTS_RAIL_COOKIE)?.value === "collapsed";

  return (
    // The title and trail across the top, 24px over the content; then the rail and the view's column, on
    // StepFrameLayout's grid (shared with the loading state, ShellLoading, so switching views redraws the title and
    // the rail where they were). The view scrolls inside its own column; the page never does (lg and up).
    <div data-step-frame className={FRAME_GRID}>
      <ReportsHeader title={title ?? reportsViewLabel(view)} info={info} chip={chip} facts={facts}>
        <div className={FRAME_RAIL_CELL}>
          <ReportsRail view={view} initialCollapsed={collapsed} />
        </div>
        <div className={FRAME_STEP_CELL}>
          {/* The view arrives in the one 150ms m-content-in on every switch; rows, figures and bars bring their own motion. */}
          <div key={view} data-page-content className={FRAME_STEP}>
            {children}
          </div>
        </div>
      </ReportsHeader>
    </div>
  );
}
