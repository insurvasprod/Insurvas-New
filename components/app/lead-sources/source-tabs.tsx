"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ListPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
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

/**
 * "Import a list" (Lead sources): steps 1–2 open in a side sheet over the page. Continuing goes to
 * the review route (steps 3–4) — it stays a route on purpose, so a big file's review survives a
 * refresh and can be linked to (Module 2 §6).
 */
export function ImportSheet({ initialOpen, children }: { initialOpen: boolean; children: ReactNode }) {
  // Opened after mount (/app/import opens it at once): the sheet is portalled to document.body,
  // which the server render does not have.
  const [open, setOpen] = useState(false);
  useEffect(() => { if (initialOpen) setOpen(true); }, [initialOpen]); // eslint-disable-line react-hooks/set-state-in-effect
  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    if (url.pathname === "/app/import") url.pathname = "/app/lead-sources";
    url.searchParams.delete("import");
    window.history.replaceState(window.history.state, "", url.toString());
  };
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}><ListPlus aria-hidden="true" />Import a list</Button>
      {/* Portalled to the body: the page's stage animates with a transform, which would make a
          position: fixed sheet fixed to the header instead of the window. */}
      {open && createPortal(
        <DetailPanel
          mode="overlay"
          title="Import a list"
          subtitle="Steps 1 and 2 · nothing is imported until step 4"
          onClose={close}
          className="lg:w-[min(1040px,calc(100vw-120px))]"
          bodyClassName="flex flex-col gap-6 p-5"
        >
          {children}
        </DetailPanel>,
        document.body,
      )}
    </>
  );
}
