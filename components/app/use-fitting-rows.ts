"use client";

/**
 * @deprecated 2026-10-09: the one implementation is components/ui/use-fitting-page-size. This module
 * keeps its old name as a pass-through so existing imports keep working.
 */
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";

export function useFittingRows(reserved: number, rowHeight: number, min = 5, max = 10) {
  return useFittingPageSize(reserved, rowHeight, { min, max });
}

/**
 * A TableCard that reaches the bottom of the window: a column whose table wrapper takes the spare
 * height, so the footer (the pager) sits at the bottom even when a page has few rows. Pair it with a
 * `min-h-[calc(100dvh-var(--top-bar-h)-<chrome>px)]` for the chrome above the card.
 */
export const FILL_CARD = "flex flex-col [&>div.overflow-x-auto]:flex-1";
