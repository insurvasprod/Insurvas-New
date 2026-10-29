"use client";

import { useState, type ReactNode } from "react";

import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * The two merged pages (owner pick 2026-10-26: "Lead sources" for vendors, campaigns, lists and
 * import; "Vendor bills" for invoices and returns). One header, the tabs this person may open, and
 * each tab's own screen below — the screens themselves are the ones that used to be pages.
 *
 * The tab is kept in the URL (?tab=) with history.replaceState, so a refresh or a shared link opens
 * the same tab without a server round trip on every switch.
 */
export type SourceTab = { key: string; label: string; panel: ReactNode };

export function SourceTabs({ tabs, initialTab, label }: { tabs: SourceTab[]; initialTab: string; label: string }) {
  const [tab, setTab] = useState(tabs.some((item) => item.key === initialTab) ? initialTab : tabs[0]?.key);
  const choose = (key: string) => {
    setTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url.toString());
  };
  return (
    // No entrance animation here: the page's m-stagger leaves an identity transform on its children,
    // which would pin each tab's overlay panels (an invoice, a claim) to this box instead of the window.
    <div className="flex flex-col gap-6" style={{ animation: "none" }}>
      {tabs.length > 1 && <ViewTabs label={label} value={tab} controls="source-tab-panel" onChange={choose} tabs={tabs.map((item) => ({ key: item.key, label: item.label }))} />}
      {/* Only the open tab is mounted: each screen loads its own data, so the others cost nothing. */}
      {tabs.map((item) => (
        <div key={item.key} id={item.key === tab ? "source-tab-panel" : undefined} role="tabpanel" hidden={item.key !== tab}>
          {item.key === tab ? item.panel : null}
        </div>
      ))}
    </div>
  );
}
