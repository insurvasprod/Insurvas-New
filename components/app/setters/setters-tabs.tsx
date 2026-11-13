"use client";

import { useState, type ReactNode } from "react";

import { CalendarAvailabilitySettings } from "@/components/app/calendar-availability-settings";
import { PageHeader } from "@/components/ui/page-header";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { SettersTab } from "@/lib/setters/tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "setup", label: "Setup" },
] as const;

/**
 * Appointments & setters in two tabs: how the setters are doing (Overview) and the hours, blocks and
 * booking rules the diary is built from (Setup). The diary itself is the Calendar page (owner
 * 2026-11-09: the Calendar tab is removed). Only the tab on screen is mounted. The choice is kept in
 * the address (?tab=) so a link or a reload lands on the same tab.
 */
export function SettersTabs({ initial, overview }: { initial: SettersTab; overview: ReactNode }) {
  const [tab, setTab] = useState<SettersTab>(initial);
  const choose = (next: SettersTab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url);
    } catch { /* the tab still switches */ }
  };
  return (
    <div className="m-stagger flex flex-col gap-6">
      {/* The sub-page bar this page drew first is now everyone's (UI-CONSISTENCY §8b): PageHeader's own tabs row. */}
      <PageHeader title="Appointments & setters" tabs={<UnderlineTabs label="Appointments and setters" tabs={TABS} value={tab} onChange={choose} controls="setters-panel" idPrefix="setters" />} />

      <div id="setters-panel" role="tabpanel" aria-labelledby={`setters-tab-${tab}`} className="flex flex-col gap-6">
        {tab === "overview" && overview}
        {tab === "setup" && <CalendarAvailabilitySettings />}
      </div>
    </div>
  );
}
