import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { PageTrail } from "./page-trail";
import { InfoTip } from "@/components/ui/info-tip";
import { PageAlertSlot } from "@/components/ui/page-alerts";

/**
 * The top of every page, in one shape (owner 2026-10-30, the Partner Chat header everywhere):
 *
 *   Group › Page            the trail, from the menu (PageTrail) unless the page passes its own
 *   Title (i)  lead    actions   the page's one <h1> with its (i) right beside it, then a merged
 *                                 page's tabs (`lead`), and the actions on the right
 *
 * The top bar no longer names the page. `description` sits behind the (i) by default
 * (`infoDescription={false}` shows it as one line under the title). The header never grows the page
 * past the window: it is one row plus the trail, and the content under it takes what is left.
 *
 * `size`, `eyebrow` and `visible` are kept so no caller has to change.
 */
export function PageHeader({
  title,
  titleInfo,
  description,
  actions,
  lead,
  size = "page",
  breadcrumbs,
  meta,
  infoDescription = true,
  className,
}: {
  /** The description behind an (i) beside the title (default) rather than a line under it. */
  infoDescription?: boolean;
  /** Accepted and ignored (2026-10-30): every header shows its title now. */
  visible?: boolean;
  /** The trail above the title, the last one this page. Left out, the menu draws it. */
  breadcrumbs?: Crumb[];
  /** One quiet line under the title (Settings: who last changed something here). */
  meta?: ReactNode;
  /** Accepted and ignored (2026-09-28 review): one title per page. */
  eyebrow?: string;
  title: string;
  /** A help tip or chip right beside the title (owner 2026-11-02: never out by the actions). */
  titleInfo?: ReactNode;
  /** A merged page's tabs, on the title's line (owner 2026-11-02), so the step's first card starts
   *  level with the rail's top. An empty slot takes no room. */
  lead?: ReactNode;
  description?: string;
  actions?: ReactNode;
  size?: "page" | "hero";
  className?: string;
}) {
  return (
    <header data-page-header="visible" className={cn("flex shrink-0 flex-col gap-1.5", className)}>
      {breadcrumbs ? <Breadcrumbs crumbs={breadcrumbs} /> : <PageTrail title={title} />}
      {/* With a merged page's tabs (`lead`), the line is a grid from lg up: the title in a column as wide as
          the page's rail (--frame-rail-w, set by the frame), so the tabs start on the cards' left edge and
          read as the step's own views, not a tail on the title (owner 2026-11-02, UI-CONSISTENCY §8a). */}
      <div className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3",
        lead && "lg:grid lg:grid-cols-[minmax(var(--frame-rail-w,0px),max-content)_minmax(0,1fr)_auto] lg:gap-x-4",
      )}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-1.5">
              <h1 data-page-title data-size={size} className="m-0 font-[family-name:var(--font-display)] text-page text-[var(--ink)]">{title}</h1>
              {/* To the right of the (i), not under it (owner, 2026-10-29): below the title it spills back across
                  the heading and the trail. */}
              {description && infoDescription && <InfoTip label={`About ${title}`} side="right">{description}</InfoTip>}
              {titleInfo}
            </div>
            {/* The shell's alerts (an overdue complaint, a payment problem) on the title's line, never a
                banner above the page (owner 2026-11-02: the banner pushed every page into a scroll). With
                tabs they follow the tabs instead, so the title column stays the rail's width. */}
            {!lead && <PageAlertSlot />}
          </div>
          {description && !infoDescription && <p className="mt-1 text-sm leading-normal text-muted-foreground">{description}</p>}
          {meta}
        </div>
        {lead && (
          <div data-page-lead className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 max-lg:w-full">
            {lead}
            <PageAlertSlot />
          </div>
        )}
        {/* On a phone the actions take their own line, so the title keeps the first one whole —
            at 320 the header otherwise squeezed the title block until its (i) was cut off. */}
        {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2 max-sm:w-full empty:hidden">{actions}</div>}
      </div>
    </header>
  );
}
