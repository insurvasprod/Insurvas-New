import Link from "next/link";
import type { ReactNode } from "react";

import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import { cardSurface } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One graph card on the admin dashboard (admin round 1, board section 1 `.gc`): a small label with the tab
 * or page that explains it on the right, the headline figure (muted when it is old), one line of what the
 * figure is doing, then the graph. `span` makes it two columns wide on the four-column grid.
 *
 * Every card loads and fails on its own (frame first, UI-CONSISTENCY §7a): the tab wraps each in Suspense
 * with `GraphCardLoading`, and a card whose reads throw draws `GraphCardError` instead of taking the tab down.
 */
export function GraphCard({
  title,
  link,
  value,
  stale = false,
  line,
  span = false,
  children,
  foot,
}: {
  title: string;
  /** The tab or page that explains the figure; omitted when the role cannot open it. */
  link?: { label: string; href: string } | null;
  value?: ReactNode;
  /** The figure is from data that stopped updating: drawn muted, and `line` says how old. */
  stale?: boolean;
  line?: ReactNode;
  span?: boolean;
  children?: ReactNode;
  /** A muted line under the graph: why it is short, where it stops. */
  foot?: ReactNode;
}) {
  return (
    <section aria-label={title} className={cn(cardSurface, "flex min-w-0 flex-col px-4 pb-3 pt-3", span && "md:col-span-2")}>
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 min-w-0 truncate text-xs font-semibold text-muted-foreground" title={title}>{title}</h2>
        {link && (
          <Link href={link.href} className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground no-underline hover:text-foreground">
            {link.label} ›
          </Link>
        )}
      </div>
      {value !== undefined && (
        <div className={cn("mt-0.5 text-2xl font-semibold leading-[1.2] tracking-[-0.02em] tabular-nums", stale ? "text-muted-foreground" : "text-foreground")}>{value}</div>
      )}
      {line && <div className="text-xs text-muted-foreground">{line}</div>}
      {children && <div className="mt-2 flex min-h-0 flex-1 flex-col">{children}</div>}
      {foot && <p className="m-0 mt-1.5 text-xs text-muted-foreground">{foot}</p>}
    </section>
  );
}

/** The card while its reads are on the way: its title, then the figure and the graph as skeletons. */
export function GraphCardLoading({ title, span = false }: { title: string; span?: boolean }) {
  return (
    <GraphCard title={title} span={span}>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <span className="sr-only">Loading {title.toLowerCase()}</span>
        <span aria-hidden="true" className="m-skel h-6 w-2/5 rounded-md" />
        <span aria-hidden="true" className="m-skel h-[120px] w-full rounded-md" />
      </div>
    </GraphCard>
  );
}

/** A graph that could not be read: said plainly, with a way to try again. The rest of the tab is unaffected. */
export function GraphCardError({ title, span = false }: { title: string; span?: boolean }) {
  return (
    <GraphCard title={title} span={span}>
      <GraphEmpty title="Couldn't load this graph" hint="Its figures didn't answer. The rest of the page is current." action={<DashboardRefresh />} />
    </GraphCard>
  );
}

/** Nothing to draw yet, and why: inside a card, so it is quieter than a page's EmptyState. */
export function GraphEmpty({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      <p className="m-0 max-w-[44ch] text-xs text-muted-foreground">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Runs a card's reads and hands back the data or null, logging the failure: the card then draws
 * GraphCardError. Kept out of the JSX so nothing renders inside a try.
 */
export async function settleCard<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`[admin-dashboard] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}
