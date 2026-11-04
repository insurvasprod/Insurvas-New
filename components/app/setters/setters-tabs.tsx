"use client";

import { useState, type ReactNode } from "react";

import { AppointmentCalendar } from "@/components/app/appointment-calendar";
import { CalendarAvailabilitySettings } from "@/components/app/calendar-availability-settings";
import { PageHeader } from "@/components/ui/page-header";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { SettersTab } from "@/lib/setters/tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "calendar", label: "Calendar" },
  { key: "setup", label: "Setup" },
] as const;

/**
 * Appointments & setters in three tabs (owner 2026-11-05): how the setters are doing (Overview), the
 * diary itself (Calendar) and the hours, blocks and booking rules it is built from (Setup). Only the
 * tab on screen is mounted, so the calendar and the editor load when they are opened. The choice is
 * kept in the address (?tab=) so a link or a reload lands on the same tab.
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
      <PageHeader title="Appointments & setters" hideTitle />
      <UnderlineTabs label="Appointments and setters" tabs={TABS} value={tab} onChange={choose} controls="setters-panel" idPrefix="setters" />

      <div id="setters-panel" role="tabpanel" aria-labelledby={`setters-tab-${tab}`} className="flex flex-col gap-6">
        {tab === "overview" && overview}
        {tab === "calendar" && <AppointmentCalendar embedded />}
        {tab === "setup" && <CalendarAvailabilitySettings />}
      </div>
    </div>
  );
}
