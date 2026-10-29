import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { buildTrail, parentOf, type Crumb } from "@/lib/navigation/breadcrumbs";
import { cn } from "@/lib/utils";
import { titleCaseNode } from "@/components/ui/title-case";

export type { Crumb };

/**
 * Where this page sits, above its title (manager review, 2026-10-28, 25:05: "navigation always
 * comes on the page"). The WAI-ARIA breadcrumb pattern: a labelled nav with an ordered list, the
 * current page as text with aria-current. Only real pages are links; a menu group is not a page and
 * is left out by the caller. Long trails fold their middle into "…" (lib/navigation/breadcrumbs.ts).
 * Below 640px only the parent shows, as "← Parent".
 */
export function Breadcrumbs({ crumbs, className }: { crumbs: Crumb[]; className?: string }) {
  const trail = buildTrail(crumbs);
  if (trail.length < 2) return null;
  const parent = parentOf(crumbs);
  const link = "rounded-sm text-muted-foreground no-underline outline-none transition-colors hover:text-foreground hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav aria-label="Breadcrumb" data-breadcrumbs="" className={cn("text-label", className)}>
      {/* Narrow screens: one step back, a full 24px target. */}
      {parent?.href && (
        <Link href={parent.href} className={cn(link, "inline-flex min-h-6 items-center gap-1 sm:hidden")}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {titleCaseNode(parent.label)}
        </Link>
      )}
      <ol className="m-0 hidden list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 sm:flex">
        {trail.map((entry, index) => (
          <li key={entry.kind === "crumb" ? `${index}-${entry.label}` : `more-${index}`} className="inline-flex min-h-6 items-center gap-1.5">
            {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
            {entry.kind === "more" ? (
              // The folded crumbs, still reachable: a native disclosure, no script needed.
              <details className="relative">
                <summary className={cn(link, "cursor-pointer list-none px-0.5")} aria-label={`${entry.hidden.length} more`}>…</summary>
                <ul className="absolute left-0 top-full z-20 mt-1 min-w-40 list-none rounded-[10px] border border-border bg-[var(--color-card)] p-1 shadow-[var(--shadow-overlay)]">
                  {entry.hidden.map((crumb) => (
                    <li key={crumb.label}>
                      {crumb.href
                        ? <Link href={crumb.href} className="block rounded-md px-2.5 py-1.5 text-sm text-foreground no-underline hover:bg-[var(--surface-alt)]">{titleCaseNode(crumb.label)}</Link>
                        : <span className="block px-2.5 py-1.5 text-sm text-muted-foreground">{titleCaseNode(crumb.label)}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ) : entry.current ? (
              <span aria-current="page" className="text-foreground">{entry.label}</span>
            ) : entry.href ? (
              <Link href={entry.href} className={link}>{titleCaseNode(entry.label)}</Link>
            ) : (
              <span className="text-muted-foreground">{titleCaseNode(entry.label)}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
