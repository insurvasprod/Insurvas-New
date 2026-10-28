import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { PageHeaderActions } from "./page-header-actions";

/**
 * The top of every page, in one shape.
 *
 * No visible title (owner 2026-10-28): the top bar's breadcrumb already says where you are, so the
 * page no longer repeats its own name. The title is still the page's `<h1>`, visually hidden, so a
 * screen reader lands on it and the bar can read it (`data-page-title`) where a shell has no menu
 * of its own to name the page. The one line of description goes with it, hidden the same way.
 *
 * What stays on screen is the actions. When the page's own tabs or step bar come straight after the
 * header (anything marked `data-page-lead`: ViewTabs, UnderlineTabs, the Inbound step bar), the
 * actions sit on that row, on the right, from md up; otherwise they are one row at the top, on the
 * right. A header with no actions takes no space at all.
 *
 * `size` and `eyebrow` are kept so no caller has to change.
 */
export function PageHeader({
  title,
  titleInfo,
  description,
  actions,
  size = "page",
  className,
}: {
  /** Accepted and ignored (2026-09-28 review): one title per page, and now that one is hidden too. */
  eyebrow?: string;
  title: string;
  /** Optional help tip retained beside the page actions when the visible title moves to the top bar. */
  titleInfo?: ReactNode;
  description?: string;
  actions?: ReactNode;
  size?: "page" | "hero";
  className?: string;
}) {
  return (
    <div className={cn("m-page-header", className)} data-has-actions={actions ? "" : undefined}>
      {/* The display face (Inter Tight, foundation v3) if it is ever shown again; sr-only for now. */}
      <h1 data-page-title data-size={size} className="sr-only font-[family-name:var(--font-display)] text-page text-[var(--ink)]">
        {title}
      </h1>
      {description && <p className="sr-only">{description}</p>}
      {(titleInfo || actions) && <PageHeaderActions>{titleInfo}{actions}</PageHeaderActions>}
    </div>
  );
}
