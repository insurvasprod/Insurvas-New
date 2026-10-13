"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { pageItems, withPage } from "@/lib/ui/pagerMath";
import { cn } from "@/lib/utils";

export { pageItems, withPage };

/**
 * The one pager, for a TableCard's `footer` slot (UI-CONSISTENCY §6). Page numbers are 1-based.
 *
 *   left   "Showing 1–25 of 312 policies", the range and the total set in the ink colour so they
 *          read first, then the caller's suffix ("newest first", a live dot…).
 *   right  first · previous · numbered pages with gaps (1 … 4 5 6 … 13) · next · last. On a phone
 *          the numbers give way to "Page 5 of 13". Nothing is drawn when everything fits one page.
 *
 * Two ways to move: `onPage` for a list paged in the browser (or fetched on demand), `pageHref` for
 * a page paged on the server by its address: the address without its page, to which `page=N` is
 * added. It renders links, so the browser's back button and a shared link keep the page, and a
 * server component can use it (it passes a string, not a function). `disabled` holds every control while a page loads.
 *
 * 2026-10-13: page numbers, first/last and a phone layout; the admin console's BoardTableFooter now
 * renders this too, so the app and the console page the same way.
 */
export function Pager({
  page,
  total,
  noun,
  onPage,
  pageHref,
  pageSize = 25,
  suffix,
  disabled = false,
  approximate = false,
}: {
  page: number;
  total: number;
  noun: string;
  onPage?: (page: number) => void;
  /** Server paging: the address without its page ("?tab=activity", "/admin/x?q=a"); `page=N` is added. */
  pageHref?: string;
  pageSize?: number;
  /** After the count, joined with " · ". */
  suffix?: ReactNode;
  /** Hold every control, e.g. while the next server page is loading. */
  disabled?: boolean;
  /** The total is an estimate ("about 4,120"). */
  approximate?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  const hrefFor = pageHref === undefined ? undefined : (to: number) => withPage(pageHref, to);
  const go = (to: number) => ({ to, off: disabled || to < 1 || to > pages || to === current });

  return (
    <>
      <span className="min-w-0 tabular-nums" aria-live="polite">
        {total === 0 ? (
          `No ${noun}`
        ) : (
          <>
            Showing <span className="font-semibold text-foreground">{start.toLocaleString("en-US")}–{end.toLocaleString("en-US")}</span> of{" "}
            <span className="font-semibold text-foreground">{approximate ? "about " : ""}{total.toLocaleString("en-US")}</span> {noun}
          </>
        )}
        {suffix ? <> · {suffix}</> : null}
      </span>
      {pages > 1 && (
        <nav aria-label={`${noun} pages`} className="flex items-center gap-1">
          <Step {...go(1)} label="First page" hrefFor={hrefFor} onPage={onPage} className="hidden sm:inline-flex"><ChevronsLeft className="size-4" aria-hidden="true" /></Step>
          <Step {...go(current - 1)} label="Previous page" hrefFor={hrefFor} onPage={onPage}><ChevronLeft className="size-4" aria-hidden="true" /></Step>
          <span className="px-2 text-xs font-semibold text-foreground tabular-nums sm:hidden">Page {current} of {pages}</span>
          <span className="hidden items-center gap-1 sm:flex">
            {pageItems(current, pages).map((item, index) =>
              item === "gap" ? (
                <span key={`gap-${index}`} className="inline-flex size-8 items-center justify-center text-muted-foreground" aria-hidden="true">…</span>
              ) : (
                <Step key={item} to={item} off={disabled} current={item === current} label={`Page ${item}`} hrefFor={hrefFor} onPage={onPage}>
                  {item.toLocaleString("en-US")}
                </Step>
              ),
            )}
          </span>
          <Step {...go(current + 1)} label="Next page" hrefFor={hrefFor} onPage={onPage}><ChevronRight className="size-4" aria-hidden="true" /></Step>
          <Step {...go(pages)} label="Last page" hrefFor={hrefFor} onPage={onPage} className="hidden sm:inline-flex"><ChevronsRight className="size-4" aria-hidden="true" /></Step>
        </nav>
      )}
    </>
  );
}

const STEP =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

function Step({ to, off, current = false, label, hrefFor, onPage, className, children }: {
  to: number;
  off: boolean;
  current?: boolean;
  label: string;
  hrefFor?: (page: number) => string;
  onPage?: (page: number) => void;
  className?: string;
  children: ReactNode;
}) {
  const look = cn(
    STEP,
    current
      ? "bg-[var(--primary)] text-[var(--on-primary)] shadow-sm"
      : "border border-border bg-[var(--surface)] text-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-alt)]",
    off && !current && "pointer-events-none opacity-40",
    className,
  );
  if (current) return <span className={look} aria-current="page" aria-label={label}>{children}</span>;
  if (hrefFor && !off) return <Link href={hrefFor(to)} className={look} aria-label={label} scroll={false}>{children}</Link>;
  return (
    <button type="button" className={look} aria-label={label} disabled={off} onClick={() => onPage?.(to)}>
      {children}
    </button>
  );
}

/** Clamp a 1-based page number to the rows that exist, and slice them. */
export function paginate<T>(rows: T[], page: number, pageSize = 25) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { current, pages, rows: rows.slice((current - 1) * pageSize, current * pageSize) };
}
