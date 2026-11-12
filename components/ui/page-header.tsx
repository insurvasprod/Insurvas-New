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
 *   Title (i)  Overview  Calendar  Setup   actions   the page's one <h1> with its (i) right beside it, then the
 *              ──────────────────────────────────────  page's sub-pages or views (`tabs`, the sub-page bar: its
 *                                                       hairline runs on under the buttons, which stand above it)
 *                                                       (owner 2026-11-09, UI-CONSISTENCY §8b). A status or a step
 *                                                       bar that belongs on the line is `lead`.
 *
 * The top bar no longer names the page. `description` sits behind the (i); nothing is drawn under the title
 * (owner 2026-11-10), so `infoDescription` and `meta` are accepted and ignored. The header never grows the page
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
  tabs,
  size = "page",
  breadcrumbs,
  hideTitle = false,
  className,
}: {
  /**
   * The trail is the title (Settings, owner 2026-11-03): one line with the alerts, the (i) and the
   * actions beside it. The <h1> stays for screen readers and the document outline.
   */
  hideTitle?: boolean;
  /** Accepted and ignored (owner 2026-11-10: no text under a title): the description is always behind the (i). */
  infoDescription?: boolean;
  /** Accepted and ignored (2026-10-30): every header shows its title now. */
  visible?: boolean;
  /** The trail above the title, the last one this page. Left out, the menu draws it. */
  breadcrumbs?: Crumb[];
  /** Accepted and ignored (owner 2026-11-10: "if there is text under the title, please remove it"). */
  meta?: ReactNode;
  /** Accepted and ignored (2026-09-28 review): one title per page. */
  eyebrow?: string;
  title: string;
  /** A help tip or chip right beside the title (owner 2026-11-02: never out by the actions). */
  titleInfo?: ReactNode;
  /** Something that belongs on the title's line: a record's status, a call's step bar. Never the page's
   *  tabs — those are `tabs` (owner 2026-11-09). An empty slot takes no room. */
  lead?: ReactNode;
  /**
   * The page's sub-pages or views: `ViewTabs` / `UnderlineTabs`, drawn as the sub-page bar on the title's line,
   * between the title and the buttons (owner 2026-11-09: the underline bar, "everything in line"). In a merged
   * page's frame it starts on the step's left edge while the rail is open. A slot that a client screen fills later
   * (a portal target) takes no room while it is empty.
   */
  tabs?: ReactNode;
  description?: string;
  actions?: ReactNode;
  size?: "page" | "hero";
  className?: string;
}) {
  if (hideTitle) {
    return (
      <header data-page-header="visible" className={cn("flex shrink-0 flex-col gap-1", className)}>
        <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2", tabs && "gap-x-4 lg:flex-nowrap")}>
          <div className={cn("flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1", tabs && "shrink-0")}>
            <div className="flex items-center gap-1.5">
              {breadcrumbs ? <Breadcrumbs crumbs={breadcrumbs} /> : <PageTrail title={title} />}
              {description && <InfoTip label={`About ${title}`} side="right">{description}</InfoTip>}
            </div>
            <PageAlertSlot />
          </div>
          {/* A step bar on the trail's line (Inbound's call, owner 2026-11-09), centred in what is left. */}
          {lead && <div data-page-lead className="flex min-w-0 flex-1 items-center justify-center max-lg:order-last max-lg:w-full">{lead}</div>}
          {tabs ? (
            <SubpageLine actions={(titleInfo || actions) ? <>{titleInfo}{actions}</> : null}><TabsCell>{tabs}</TabsCell></SubpageLine>
          ) : (
            (titleInfo || actions) && <div data-page-actions className="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-2 max-sm:w-full">{titleInfo}{actions}</div>
          )}
        </div>
        <h1 data-page-title data-size={size} className="sr-only">{title}</h1>
      </header>
    );
  }
  const inline = Boolean(lead || tabs);
  return (
    <header data-page-header="visible" className={cn("flex shrink-0 flex-col gap-1.5", className)}>
      {breadcrumbs ? <Breadcrumbs crumbs={breadcrumbs} /> : <PageTrail title={title} />}
      {/* One line from lg up (owner 2026-11-09: "I want to have everything in line"): the title, then the sub-page bar,
          then the buttons. The bar sits the same 16px after the title on every page, rail open or collapsed (owner
          2026-11-09), and one hairline runs under the bar and the buttons to the line's end (`SubpageLine`).
          The line never wraps at lg: the bar takes what is left; a bar
          with more tabs than room scrolls sideways (TabTrack). Under lg the bar takes a line of its own. */}
      <div className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3",
        inline && "gap-x-4 lg:flex-nowrap",
      )}>
        <div className={cn("min-w-0", inline ? "shrink-0 lg:max-w-[45%]" : "flex-1")}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 data-page-title data-size={size} className="m-0 min-w-0 font-[family-name:var(--font-display)] text-page text-[var(--ink)]">{title}</h1>
              {/* To the right of the (i), not under it (owner, 2026-10-29): below the title it spills back across
                  the heading and the trail. */}
              {description && <InfoTip label={`About ${title}`} side="right">{description}</InfoTip>}
              {titleInfo}
            </div>
            {/* The shell's alerts (an overdue complaint, a payment problem) on the title's line, never a
                banner above the page (owner 2026-11-02: the banner pushed every page into a scroll). With
                tabs they follow the tabs instead, so the title column stays the rail's width. */}
            {!inline && <PageAlertSlot />}
          </div>
        </div>
        {lead && (
          <div data-page-lead className={cn("flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 max-lg:w-full", !tabs && "lg:flex-1")}>
            {lead}
            {!tabs && <PageAlertSlot />}
          </div>
        )}
        {tabs ? (
          // The bar and the buttons share one hairline that runs to the line's end (owner 2026-11-09, Daily deal flow):
          // the buttons stand on it with a gap above it, never centred on it. Under lg the wrapper dissolves and the
          // bar takes a line of its own, as before.
          <SubpageLine actions={actions}><TabsCell alerts>{tabs}</TabsCell></SubpageLine>
        ) : (
          // On a phone the actions take their own line, so the title keeps the first one whole —
          // at 320 the header otherwise squeezed the title block until its (i) was cut off.
          actions && <div data-page-actions className="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-2 max-sm:w-full empty:hidden">{actions}</div>
        )}
      </div>
    </header>
  );
}

/**
 * The sub-page bar and the title line's buttons on one hairline (owner 2026-11-09): from lg up the line runs from the
 * first tab to the line's end, under the buttons too, and the buttons stand above it with a 6px gap, so the bar and
 * the buttons read as two things. Under lg the wrapper is `contents`: the bar keeps its own line (its tabs draw their
 * own hairline) and the buttons wrap as before. globals.css drops the tabs' own hairline inside this line.
 */
function SubpageLine({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <div data-subpage-line className="contents lg:flex lg:min-w-0 lg:flex-1 lg:items-end lg:gap-x-4 lg:self-stretch lg:border-b lg:border-border">
      {children}
      {actions && <div data-page-actions className="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-2 max-sm:w-full empty:hidden lg:mb-1.5">{actions}</div>}
    </div>
  );
}

/**
 * The sub-page bar's place on the title line: it takes the room between the title and the buttons, and its tabs
 * stretch across it, so the hairline runs from the first tab to just before the buttons. A picker a step puts beside
 * the tabs sits at its end. A cell with nothing in it yet — a portal slot before its screen mounts — is not drawn
 * (globals.css, `[data-page-tabs]`).
 */
function TabsCell({ alerts = false, children }: { alerts?: boolean; children: ReactNode }) {
  return (
    <div data-page-tabs className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-2 max-lg:order-last max-lg:basis-full [&>[role=tablist]]:flex-1 [&_[data-subpage-tabs]]:flex-1">
      {children}
      {alerts && <PageAlertSlot />}
    </div>
  );
}
