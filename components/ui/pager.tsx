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
  pageSize = 10,
  suffix,
  disabled = false,
  approximate = false,
  compact = false,
  layout = "standard",
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
  /** A narrow card (the Dialer's queue, 2026-10-29): the phone layout at every width, so the pager stays one line. */
  compact?: boolean;
  /** Three-part control for a board lane: previous, centred page fraction, next. */
  layout?: "standard" | "stepper";
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  const hrefFor = pageHref === undefined ? undefined : (to: number) => withPage(pageHref, to);
  const go = (to: number) => ({ to, off: disabled || to < 1 || to > pages || to === current });

  if (layout === "stepper") return pages > 1 ? (
    <nav aria-label={`${noun} pages`} className="flex w-full items-center justify-between gap-2">
      <Step {...go(current - 1)} label="Previous page" hrefFor={hrefFor} onPage={onPage} className="size-8 min-w-8 px-0"><ChevronLeft className="size-4" aria-hidden="true" /></Step>
      <span aria-live="polite" className="px-2 text-xs font-semibold tabular-nums text-foreground"><span className="sr-only">Page </span>{current} / {pages}<span className="sr-only"> pages</span></span>
      <Step {...go(current + 1)} label="Next page" hrefFor={hrefFor} onPage={onPage} className="size-8 min-w-8 px-0"><ChevronRight className="size-4" aria-hidden="true" /></Step>
    </nav>
  ) : null;

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
          <Step {...go(1)} label="First page" hrefFor={hrefFor} onPage={onPage} className={compact ? "hidden" : "hidden sm:inline-flex"}><ChevronsLeft className="size-4" aria-hidden="true" /></Step>
          <Step {...go(current - 1)} label="Previous page" hrefFor={hrefFor} onPage={onPage}><ChevronLeft className="size-4" aria-hidden="true" /></Step>
          <span className={cn("px-2 text-xs font-semibold text-foreground tabular-nums", !compact && "sm:hidden")}>Page {current} of {pages}</span>
          <span className={cn("hidden items-center gap-1", !compact && "sm:flex")}>
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
          <Step {...go(pages)} label="Last page" hrefFor={hrefFor} onPage={onPage} className={compact ? "hidden" : "hidden sm:inline-flex"}><ChevronsRight className="size-4" aria-hidden="true" /></Step>
        </nav>
      )}
    </>
  );
}

const STEP =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

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
      : "border border-border bg-[var(--surface)] text-foreground hover:border-[var(--border-strong)] hover:bg-[var(--hover-wash)]",
    off && !current && "pointer-events-none opacity-40",
    className,
  );
  if (current) return <span className={look} aria-current="page" aria-label={label}>{children}</span>;
  if (hrefFor && !off) return <Link href={hrefFor(to)} className={look} aria-label={label} scroll={false} onClick={(event) => markPageTurn(event.currentTarget, to, true)}>{children}</Link>;
  return (
    <button type="button" className={look} aria-label={label} disabled={off} onClick={(event) => { markPageTurn(event.currentTarget, to); onPage?.(to); }}>
      {children}
    </button>
  );
}

/**
 * A list paged in the browser turns its page with motion wherever it is (§ Motion, "rows-page"): the click stamps the
 * direction on its own card's rows just before the next page is drawn, so the rows that mount come in from that
 * side; the stamp goes again once they have, so a later filter or refresh does not slide. A list that keys its rows
 * itself (PagedBody, usePageTurn) already carries its own stamp and is left alone.
 *
 * `server`: a page fetched by its address arrives after a round trip, so the stamp waits for the rows to change —
 * stamping at the click would set the old rows moving — and is given up if nothing arrives in 10s.
 */
function markPageTurn(button: HTMLElement, to: number, server = false) {
  const card = button.closest('[data-slot="table-card"]');
  const rows = card?.querySelector<HTMLElement>("tbody, [data-paged-body], ul[aria-label]");
  if (!card || !rows || rows.hasAttribute("data-page-turn")) return;
  // Previous and First go back; a numbered page goes back when it is lower than the page on show.
  const label = button.getAttribute("aria-label") ?? "";
  const current = Number(button.closest("nav")?.querySelector('[aria-current="page"]')?.textContent?.replace(/\D/g, "") || NaN);
  const turn = /^(Previous|First)/.test(label) || (Number.isFinite(current) && to < current) ? "prev" : "next";
  const stamp = (target: HTMLElement) => {
    target.dataset.pageTurn = turn;
    window.setTimeout(() => { delete target.dataset.pageTurn; }, 450);
  };
  if (!server) { stamp(rows); return; }
  const watched = card as HTMLElement;
  const ROWS = "tbody, [data-paged-body], ul[aria-label]";
  const watch = new MutationObserver((records) => {
    // Only the rows changing counts — not the pager's own pending marker, which lands in the card first.
    const rowsChanged = records.some((record) => (record.target instanceof Element && record.target.closest(ROWS)) || [...record.addedNodes].some((node) => node instanceof Element && node.matches(ROWS)));
    const now = rowsChanged ? watched.querySelector<HTMLElement>(ROWS) : null;
    if (!now) return;
    watch.disconnect();
    window.clearTimeout(giveUp);
    stamp(now);
  });
  watch.observe(watched, { childList: true, subtree: true });
  const giveUp = window.setTimeout(() => watch.disconnect(), 10_000);
}

/** Clamp a 1-based page number to the rows that exist, and slice them. */
export function paginate<T>(rows: T[], page: number, pageSize = 10) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { current, pages, rows: rows.slice((current - 1) * pageSize, current * pageSize) };
}
