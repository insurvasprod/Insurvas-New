"use client";

import { useState, type ReactNode } from "react";

import { ViewTabs, type ViewTab } from "@/components/ui/view-tabs";

/**
 * Tabs whose panels a server page has already rendered: the page hands its sections in as nodes and
 * this client island only switches which one shows (the lead-list detail, persistency, a policy).
 */
export function TabbedPanels<K extends string>({
  label,
  tabs,
  actions,
  initial,
  idPrefix = "view",
}: {
  label: string;
  tabs: ReadonlyArray<ViewTab<K> & { panel: ReactNode }>;
  actions?: ReactNode;
  initial?: K;
  idPrefix?: string;
}) {
  const [value, setValue] = useState<K | undefined>(initial ?? tabs[0]?.key);
  const current = tabs.find((tab) => tab.key === value) ?? tabs[0];
  if (!current) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ViewTabs label={label} tabs={tabs} value={current.key} onChange={setValue} actions={actions} idPrefix={idPrefix} />
      <div role="tabpanel" aria-labelledby={`${idPrefix}-${current.key}`} className="min-w-0">{current.panel}</div>
    </div>
  );
}
