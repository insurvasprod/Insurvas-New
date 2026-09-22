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
    <section className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      {hasHeading && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold tracking-[-0.015em]">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}

      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted px-5 py-3">
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto">{children}</div>

      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  );
}
