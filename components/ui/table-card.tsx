import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
  action,
  toolbar,
  footer,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeading = Boolean(title || description || action);

  return (
    <section
      data-slot="table-card"
      className={cn(
        "rounded-lg border border-border bg-card",
        "[&>*:first-child]:rounded-t-[7px] [&>*:last-child]:rounded-b-[7px]",
        "shadow-[0_1px_2px_rgba(16,20,26,.05)] dark:shadow-[0_1px_2px_rgba(0,0,0,.55)]",
        className
      )}
    >
      {hasHeading && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}

      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-[var(--surface-alt)] px-4 py-3">
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto">{children}</div>

      {footer && (
        /* The footer sits on the page grey, not the card white: it is the card's plinth, and a
           white strip under a white table is a row nobody can tell from the last one. */
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[var(--canvas)] px-4 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  );
}
