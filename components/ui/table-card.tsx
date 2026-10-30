import type { ReactNode } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { titleCaseNode } from "@/components/ui/title-case";

/**
 * A list page's one object: a card whose table runs edge to edge.
 *
 * The card's horizontal padding lives on the header and footer rather than the card, because a
 * table inset from the card's edge wastes the two columns a dense screen can least afford and
 * makes the header row look like it belongs to something else.
 *
 * `toolbar` sits below the heading and above the rules: search, filters, bulk actions. `footer` is
 * where pagination goes. Both are optional; a table with neither is just the card.
 *
 * No `overflow-hidden` on the card (2026-09-28): it clipped the toolbar's filter popovers and
 * menus. The first and last blocks round their own corners instead, and the table scrolls sideways
 * inside its own wrapper.
 */
export function TableCard({
  title,
  description,
  info,
  action,
  toolbar,
  filters,
  footer,
  children,
  className,
}: {
  title?: string;
  description?: string;
  /** Why the list exists, behind an (i) beside the title (2026-10-29). */
  info?: string;
  action?: ReactNode;
  toolbar?: ReactNode;
  /** Under the toolbar, above the table: `<FilterPanel>` then `<ActiveFilters>` (UI-CONSISTENCY §6a). */
  filters?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeading = Boolean(title || description || action);

  return (
    <section
      data-slot="table-card"
      className={cn(
        // m-glass: the frosted surface shared with Card and StatStrip (app/globals.css, glass layer).
        "m-glass rounded-lg border border-border",
        "[&>*:first-child]:rounded-t-[15px] [&>*:last-child]:rounded-b-[15px]",
        className
      )}
    >
      {hasHeading && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            {title && (
              <div className="flex min-w-0 items-center gap-1">
                <h2 className="text-card-title text-[var(--ink)]">{titleCaseNode(title)}</h2>
                {info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}
              </div>
            )}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}

      {toolbar && (
        // A rule above and below: the filters read as their own band, apart from the column headers.
        <div className="m-glass-head flex flex-wrap items-center gap-2 border-y border-border px-4 py-3">
          {toolbar}
        </div>
      )}

      {/* The filter panel and the active-filter chips draw their own bottom rule; the toolbar's
          border-b sits above them. Empty when neither is showing. */}
      {filters && <div data-slot="table-card-filters" className="bg-[var(--surface-alt)]/40">{filters}</div>}

      <div className="overflow-x-auto">{children}</div>

      {footer && (
        /* The footer sits on the page grey, not the card white: it is the card's plinth, and a
           white strip under a white table is a row nobody can tell from the last one. */
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[color-mix(in_srgb,var(--canvas)_45%,transparent)] px-4 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  );
}
