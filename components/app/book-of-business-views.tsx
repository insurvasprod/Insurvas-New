"use client";

/**
 * @deprecated 2026-10-09: the one implementations are components/ui/view-tabs and
 * components/ui/use-fitting-page-size. This module keeps its old names and shapes (`active` rather
 * than `value`) as thin pass-throughs so existing imports keep working.
 */
import { ViewTabs as SharedViewTabs, type ViewTab as SharedViewTab } from "@/components/ui/view-tabs";
import { useFittingPageSize as useSharedFittingPageSize } from "@/components/ui/use-fitting-page-size";

export type ViewTab<K extends string> = SharedViewTab<K>;

export function ViewTabs<K extends string>({ active, ...rest }: {
  label: string;
  tabs: Array<ViewTab<K>>;
  active: K;
  onChange?: (key: K) => void;
  controls?: string;
}) {
  return <SharedViewTabs {...rest} value={active} />;
}

export function useFittingPageSize(reserved: number, rowHeight: number) {
  return useSharedFittingPageSize(reserved, rowHeight);
}
