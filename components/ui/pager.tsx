"use client";

import { Button } from "./button";

/**
 * The one pager (2026-09-28): "Showing 1–10 of 27 leads" and Previous / Next, for a TableCard's
 * `footer` slot. Page numbers are 1-based. Hidden buttons when everything fits on one page.
 */
export function Pager({
  page,
  total,
  noun,
  onPage,
  pageSize = 25,
  suffix,
}: {
  page: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
  pageSize?: number;
  suffix?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return (
    <>
      <span>
        {total === 0
          ? `No ${noun}`
          : `Showing ${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, total)} of ${total.toLocaleString()} ${noun}`}
        {suffix ? ` · ${suffix}` : ""}
      </span>
      {pages > 1 && (
        <span className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={current <= 1} onClick={() => onPage(current - 1)}>Previous</Button>
          <Button type="button" variant="outline" size="sm" disabled={current >= pages} onClick={() => onPage(current + 1)}>Next</Button>
        </span>
      )}
    </>
  );
}

/** Clamp a 1-based page number to the rows that exist, and slice them. */
export function paginate<T>(rows: T[], page: number, pageSize = 25) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { current, pages, rows: rows.slice((current - 1) * pageSize, current * pageSize) };
}
