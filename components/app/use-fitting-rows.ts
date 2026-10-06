"use client";

import { useEffect, useState } from "react";

/**
 * Rows per page: as many as fit the window under the page's own chrome (header, strip, toolbar,
 * column heads, pager), so the pager sits at the foot of the window rather than a scroll away.
 * Recomputed on resize. The same rule as the transfer inbox's local hook (2026-10-06 redesign), for
 * the partner, vendor and campaign screens.
 */
export function useFittingRows(reserved: number, rowHeight: number, min = 5, max = 50) {
  const [size, setSize] = useState(10);
  useEffect(() => {
    const fit = () => setSize(Math.min(max, Math.max(min, Math.floor((window.innerHeight - reserved) / rowHeight))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [reserved, rowHeight, min, max]);
  return size;
}

/**
 * A TableCard that reaches the bottom of the window: a column whose table wrapper takes the spare
 * height, so the footer (the pager) sits at the bottom even when a page has few rows. Pair it with a
 * `min-h-[calc(100dvh-var(--top-bar-h)-<chrome>px)]` for the chrome above the card.
 */
export const FILL_CARD = "flex flex-col [&>div.overflow-x-auto]:flex-1";
