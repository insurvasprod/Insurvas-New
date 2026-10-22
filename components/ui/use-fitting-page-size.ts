"use client";

import { useEffect, useState } from "react";

/** No list shows more than 10 rows a page (owner rule, 2026-10-13). */
export const MAX_ROWS = 10;

/**
 * Rows per page: as many as fit the window once `reserved` pixels of the page's own chrome are taken
 * (header, strip, toolbar, column heads, pager), between `min` and `max`, so the pager sits at the
 * foot of the window rather than a scroll away. Recomputed on resize; `fallback` until measured.
 *
 * One hook (2026-10-09): the redesign had nine copies of it.
 */
export function useFittingPageSize(reserved: number, rowHeight: number, { fallback = 10, min = 5, max = 10 }: { fallback?: number; min?: number; max?: number } = {}) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const fit = () => setSize(Math.min(max, MAX_ROWS, Math.max(min, Math.floor((window.innerHeight - reserved) / rowHeight))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [reserved, rowHeight, min, max]);
  return size;
}
