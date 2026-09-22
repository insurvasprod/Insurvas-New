import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The top of every page, in one shape.
 *
 * Title on the ramp, one line of description, actions on the right. The eyebrow is the uppercase
 * label style and carries the section a page belongs to — the thing a breadcrumb would say on a
 * detail page and a category says on a list.
 *
 * `size="page"` is a workspace page (24px); `size="hero"` is the first screen of a surface — a
 * dashboard or a landing page — at 40px. Nothing else.
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
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1
          className={cn(
            "font-semibold",
            size === "hero"
              ? "text-[40px] leading-[1.08] tracking-[-0.03em]"
              : "text-2xl leading-[1.21] tracking-[-0.02em]"
          )}
        >
          {title}
        </h1>
        {description && (
          <p
            className={cn(
              "mt-1 tracking-[-0.02em] text-muted-foreground",
              size === "hero" ? "text-lg" : "text-sm"
            )}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
