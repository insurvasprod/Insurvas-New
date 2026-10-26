"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { ViewTabs } from "@/components/ui/view-tabs";
import { DraftDateCalculator } from "@/components/app/applications/draft-dates/draft-date-calculator";

export type ApplicationsView = "cases" | "waiting" | "quotes";
export type ApplicationsTab = { key: ApplicationsView; label: string; href: string };

/**
 * Applications (redesign 2026-10-26, owner pick A, canvas M3 · Applications): the four Sales lists as one
 * page. Cases (/app/applications), Waiting on the carrier (/app/pending) and Quotes (/app/quoting) are its
 * tabs — each keeps its own address and its own gate, so the dashboard's links still land — and the
 * draft-date calculator (/app/draft-dates) opens from the header as a side panel, since it saves nothing.
 */
export function ApplicationsHub({ view, tabs, calculator, calculatorOpen = false, readOnly = false, children }: {
  view: ApplicationsView;
  /** The tabs this person may open (plan features decide). */
  tabs: ApplicationsTab[];
  /** May open the draft-date calculator (draft_date_optimizer). */
  calculator: boolean;
  /** Arrived at /app/draft-dates: the calculator starts open. */
  calculatorOpen?: boolean;
  /** A read-only plan: no New application (the lists themselves only read and export). */
  readOnly?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // The panel portals to the body (the page's entrance animation would trap a fixed panel) and opens
  // once mounted, so a server render never carries it.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount, then open what the address asked for
  useEffect(() => { setMounted(true); if (calculatorOpen) setOpen(true); }, [calculatorOpen]);

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Applications"
        actions={<>
          {calculator && <Button type="button" variant="outline" onClick={() => setOpen(true)}><Calculator aria-hidden="true" />Draft-date calculator</Button>}
          {!readOnly && <Button asChild title="An application starts from the lead: open it and choose Start application"><Link href="/app/leads"><Plus aria-hidden="true" />New application</Link></Button>}
        </>}
      />
      {tabs.length > 1 && (
        <ViewTabs
          label="Application views"
          value={view}
          onChange={(key) => { const next = tabs.find((tab) => tab.key === key); if (next) router.push(next.href); }}
          tabs={tabs.map((tab) => ({ key: tab.key, label: tab.label }))}
        />
      )}
      <div className="flex min-w-0 flex-col gap-6" style={{ animation: "none" }}>{children}</div>
      {mounted && open && createPortal(
        <DetailPanel mode="overlay" title="Draft-date calculator" subtitle="The safest day to draft the premium. Nothing here is saved." onClose={() => setOpen(false)} className="lg:w-[min(100%,620px)]">
          <DraftDateCalculator sheet />
        </DetailPanel>,
        document.body,
      )}
    </div>
  );
}
