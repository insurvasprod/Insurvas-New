"use client";

/**
 * Settings › Selling › Sales process (settings round 8, owner pick A on the sales-process board, 2026-11-12).
 *
 * Six menu items became one. Its header tabs are the call in order: Overview (the step map, what needs you and
 * Try a case), Health questions, Quote inputs, Carrier application, Quote & case checks, Disclosures and Stage
 * moves. Each tab is the page it replaced, redrawn on the round-8 frame: a status line under the title, cards
 * that scroll inside, a record in a right sheet, one way to save.
 *
 * "#sales-process/<tab>" opens a tab; an anchor inside one ("#sales-process/qa-buffer", "…/pair.<carrier>.<product>")
 * opens the tab that holds it, and the tab reads the rest. The six old addresses (#sales-underwriting and the
 * rest) land here through registry.ts. A producer sees Health questions only, read-only.
 */

import { useEffect, useState } from "react";

import { SettingsSectionHeader } from "@/components/app/settings/primitives";
import { SalesDisclosures } from "@/components/app/settings/sales/disclosures";
import { SalesFieldSets } from "@/components/app/settings/sales/field-sets";
import { SalesPipelineSync } from "@/components/app/settings/sales/pipeline-sync";
import { SalesQaPreferences } from "@/components/app/settings/sales/preferences";
import { SalesQuotationTemplates } from "@/components/app/settings/sales/quotation";
import { SalesUnderwritingTemplates } from "@/components/app/settings/sales/underwriting";
import { ViewTabs } from "@/components/ui/view-tabs";
import { parseSettingsHash } from "@/lib/settings/registry";
import { PRODUCER_TABS, SALES_PROCESS_TABS, tabForAnchor, type SalesProcessTab } from "@/lib/salesSettings/salesProcess";

import { SalesOverview } from "./overview";

const SECTION = "sales-process";

export function SalesProcessSettings({ owner }: { owner: boolean }) {
  const tabs = owner ? SALES_PROCESS_TABS : SALES_PROCESS_TABS.filter((tab) => PRODUCER_TABS.includes(tab.key));
  const [tab, setTab] = useState<SalesProcessTab>(tabs[0].key);
  /** What the address named inside the tab (a record to open), handed to the tab once. */
  const [focus, setFocus] = useState<string | null>(null);
  const allowed = (key: SalesProcessTab) => tabs.some((t) => t.key === key);

  useEffect(() => {
    const fromHash = () => {
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section !== SECTION) return;
      const next = tabForAnchor(anchor);
      if (next && tabs.some((t) => t.key === next)) setTab(next);
      setFocus(anchor && anchor !== next ? anchor : null);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // The tab list is fixed for the page's life (it follows the role).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Open a tab (and a record in it): the address says so, so a reload or a shared link comes back to it. */
  const open = (next: SalesProcessTab, anchor: string | null = null) => {
    if (!allowed(next)) return;
    setTab(next);
    setFocus(anchor);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${SECTION}/${anchor ?? next}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:h-full">
      <SettingsSectionHeader
        // The section's sub-pages: the sub-page bar on the title's line (UI-CONSISTENCY §8b).
        tabs={<ViewTabs label="Sales process" tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={(key) => open(key)} controls="sales-process-panel" />}
      />
      <div id="sales-process-panel" role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label} className="flex min-h-0 flex-1 flex-col">
        {tab === "overview" && <div id="overview" className="flex min-h-0 flex-1 flex-col"><SalesOverview onOpen={open} /></div>}
        {tab === "health-questions" && <div id="health-questions" className="flex min-h-0 flex-1 flex-col"><SalesUnderwritingTemplates focus={focus} /></div>}
        {tab === "quote-inputs" && <div id="quote-inputs" className="flex min-h-0 flex-1 flex-col"><SalesQuotationTemplates focus={focus} /></div>}
        {tab === "carrier-application" && <div id="carrier-application" className="flex min-h-0 flex-1 flex-col"><SalesFieldSets focus={focus} /></div>}
        {tab === "checks" && <div id="checks" className="flex min-h-0 flex-1 flex-col"><SalesQaPreferences /></div>}
        {tab === "disclosures" && <div id="disclosures" className="flex min-h-0 flex-1 flex-col"><SalesDisclosures focus={focus} /></div>}
        {tab === "stage-moves" && <div id="stage-moves" className="flex min-h-0 flex-1 flex-col"><SalesPipelineSync /></div>}
      </div>
    </div>
  );
}
