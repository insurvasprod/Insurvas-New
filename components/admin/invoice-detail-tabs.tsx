"use client";

import { useState, type ReactNode } from "react";

import { cardSurface } from "@/components/ui/card";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { cn } from "@/lib/utils";

/**
 * The invoice detail's in-card tabs (Line items · Provider activity · Credit notes). The panels are
 * rendered on the server and handed in; this only chooses which one shows.
 */
export function InvoiceDetailTabs({ tabs }: { tabs: Array<{ id: string; label: string; count?: number; panel: ReactNode }> }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className={cn(cardSurface, "flex min-w-0 flex-col overflow-hidden")}>
      <UnderlineTabs
        label="Invoice"
        className="px-4"
        tabs={tabs.map((tab) => ({ key: tab.id, label: tab.label, count: typeof tab.count === "number" && tab.count > 0 ? tab.count : undefined }))}
        value={current?.id ?? ""}
        onChange={setActive}
        idPrefix="invoice-tab"
        controls={(key) => `invoice-panel-${key}`}
      />
      {current && <div role="tabpanel" id={`invoice-panel-${current.id}`} aria-labelledby={`invoice-tab-${current.id}`}>{current.panel}</div>}
    </div>
  );
}
