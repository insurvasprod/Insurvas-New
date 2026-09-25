"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The invoice detail's in-card tabs (Line items · Provider activity · Credit notes). The panels are
 * rendered on the server and handed in; this only chooses which one shows.
 */
export function InvoiceDetailTabs({ tabs }: { tabs: Array<{ id: string; label: string; count?: number; panel: ReactNode }> }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <div role="tablist" aria-label="Invoice" className="flex gap-6 overflow-x-auto border-b border-[var(--border)] px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`invoice-tab-${tab.id}`}
            aria-selected={tab.id === current?.id}
            aria-controls={`invoice-panel-${tab.id}`}
            onClick={() => setActive(tab.id)}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-1 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em]",
              tab.id === current?.id ? "border-[var(--primary)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && <span className="rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] tabular-nums">{tab.count}</span>}
          </button>
        ))}
      </div>
      {current && <div role="tabpanel" id={`invoice-panel-${current.id}`} aria-labelledby={`invoice-tab-${current.id}`}>{current.panel}</div>}
    </div>
  );
}
