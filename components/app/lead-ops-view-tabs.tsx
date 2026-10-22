"use client";

/**
 * @deprecated 2026-10-09: the one implementations are components/ui/view-tabs, view-tabs-panels and
 * use-fitting-page-size. This module keeps its old names as thin pass-throughs so existing imports keep
 * working; `fullHeightCard` stays here until the TableCard grows a fill option.
 */
import { cn } from "@/lib/utils";
import { useFittingPageSize as useSharedFittingPageSize } from "@/components/ui/use-fitting-page-size";

export { ViewTabs, type ViewTab } from "@/components/ui/view-tabs";
export { TabbedPanels } from "@/components/ui/view-tabs-panels";

export function useFittingPageSize(reserved: number, rowHeight: number, fallback = 10) {
  return useSharedFittingPageSize(reserved, rowHeight, { fallback });
}

/**
 * The TableCard classes that make a list card reach the bottom of the window: the card is a flex
 * column at least `chrome` px shorter than the viewport, and the table area takes the slack so the
 * footer (the pager) sits at the foot.
 */
export function fullHeightCard(chrome: number) {
  return cn("flex min-w-0 flex-col [&>.overflow-x-auto]:flex-1", FULL_HEIGHT[chrome] ?? FULL_HEIGHT[240]);
}

// Spelled out so Tailwind sees each class literally.
const FULL_HEIGHT: Record<number, string> = {
  160: "min-h-[calc(100dvh-var(--top-bar-h)-160px)]",
  200: "min-h-[calc(100dvh-var(--top-bar-h)-200px)]",
  240: "min-h-[calc(100dvh-var(--top-bar-h)-240px)]",
  300: "min-h-[calc(100dvh-var(--top-bar-h)-300px)]",
  340: "min-h-[calc(100dvh-var(--top-bar-h)-340px)]",
};
