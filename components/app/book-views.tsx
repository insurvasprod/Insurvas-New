"use client";

/**
 * @deprecated 2026-10-09: the one implementations are components/ui/view-tabs (ViewTabs),
 * components/ui/view-tabs-panels (TabbedPanels) and components/ui/use-fitting-page-size. This module
 * keeps its old names and shapes as thin pass-throughs so existing imports keep working.
 */
import type { ReactNode } from "react";

import { ViewTabs as SharedViewTabs, type ViewTab as SharedViewTab } from "@/components/ui/view-tabs";
import { TabbedPanels } from "@/components/ui/view-tabs-panels";
import { useFittingPageSize as useSharedFittingPageSize } from "@/components/ui/use-fitting-page-size";

export type ViewTab<K extends string> = SharedViewTab<K>;

export function useFittingPageSize(reserved: number, rowHeight: number) {
  return useSharedFittingPageSize(reserved, rowHeight);
}

export function ViewTabs<K extends string>(props: { label: string; tabs: readonly ViewTab<K>[]; value: K; onChange: (key: K) => void; idPrefix?: string }) {
  return <SharedViewTabs {...props} />;
}

export function TabbedSections<K extends string>({ label, sections, actions, initial }: {
  label: string;
  sections: readonly (ViewTab<K> & { content: ReactNode })[];
  actions?: ReactNode;
  initial?: K;
}) {
  return <TabbedPanels label={label} tabs={sections.map(({ content, ...tab }) => ({ ...tab, panel: content }))} actions={actions} initial={initial} idPrefix="book-view" />;
}
