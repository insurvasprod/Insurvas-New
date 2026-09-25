import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The top of every page, in one shape.
 *
 * Title on the ramp, one line of description, actions on the right. The eyebrow is the uppercase
 * label style and carries the section a page belongs to — the thing a breadcrumb would say on a
 * detail page and a category says on a list.
 *
 * One size. Every artboard in the system draws its page title at 32px/1.13/-0.025em, from the
 * dashboard to the smallest settings tab, and the description under it at 16px — because a reader
 * who lands on a list and a reader who lands on the dashboard are asking the same question, and a
 * title that changes size between them reads as a different kind of screen. `size` is kept so no
 * caller has to change, and both values now render the same type.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "page",
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  size?: "page" | "hero";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-xs leading-[1.33] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 data-size={size} className="text-[32px] font-semibold leading-[1.13] tracking-[-0.025em]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-[720px] text-base leading-[1.5] tracking-[-0.02em] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
