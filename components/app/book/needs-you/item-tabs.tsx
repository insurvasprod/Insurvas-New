"use client";

import { useState, type ReactNode } from "react";

import { UnderlineTabs } from "@/components/ui/view-tabs";

type Tab = "decide" | "row";

/**
 * A Needs you item's parts (owner 2026-11-02, round 2): Decide, then the carrier's row as sent when the item
 * came from one. The page renders both panels; this only switches which shows. There is no Notes tab: none of
 * the sources keeps notes on an item yet.
 */
export function ItemTabs({ decide, row }: { decide: ReactNode; row: ReactNode | null }) {
  const [tab, setTab] = useState<Tab>("decide");
  const tabs = [{ key: "decide" as const, label: "Decide" }, ...(row ? [{ key: "row" as const, label: "The row as sent" }] : [])];
  const current = row ? tab : "decide";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <UnderlineTabs label="This item" tabs={tabs} value={current} onChange={setTab} idPrefix="needs-you-item" controls="needs-you-item-panel" />
      <div id="needs-you-item-panel" role="tabpanel" aria-labelledby={`needs-you-item-${current}`} className="flex min-w-0 flex-col gap-4">
        {current === "row" ? row : decide}
      </div>
    </div>
  );
}
