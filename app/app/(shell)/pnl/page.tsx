import { Download } from "lucide-react";
import { Suspense } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BASIS_NOTE, resolvePeriod, type PeriodKind as PnlKind } from "@/lib/accounting/pnlCore";
import { ACQUISITION_CONSEQUENCE } from "@/lib/accounting/expensesCore";
import { pnlTabs, type PnlTab } from "@/lib/accounting/pnlLinks";
import { loadPnl, persistingCohorts, PnlError, reportingSettings } from "@/lib/accounting/pnlStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PnlBoard, PnlDownload } from "@/components/app/accounting/pnl-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Profit & loss (LA-7.7, Notion sprint). Did this month make money — and what did a policy
 * that lasts really cost. Computed live from the ledgers. Owner and bookkeeper only.
 *
 * Foundation pass (2026-11-03): Statement · Last six months · Persisting cost are the step's tabs on the title
 * line (`?view=trend|cohorts`). Round 7 (owner 2026-11-10, mockups-r7/accounting.html 5·A): the title stands
 * alone; its (i) holds only the chosen basis's sentence and the acquisition rule; Download (CSV) is the title
 * line's one button. The 1099 count is Tax's (its tab count and the bell), not a card here.
 */
export default async function PnlPage({ searchParams }: { searchParams: Promise<{ kind?: string; anchor?: string; from?: string; to?: string; basis?: string; view?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Profit & loss" description="Money in, money out, and what a lasting policy really cost." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Profit & loss" detail="Only owners and bookkeepers can see the agency's profit and loss." />;
  }
  const q = await searchParams;
  const view: PnlTab = q.view === "trend" || q.view === "cohorts" ? q.view : "statement";
  const tenantId = guard.context.tenantId;
  // Frame first (UI-CONSISTENCY §7a): the settings, the period and the statement are read now, awaited by the blocks
  // below; the title, the three tabs and Download draw at once.
  const read: PnlRead = (async () => {
    try {
      const settings = await reportingSettings(tenantId);
      const period = resolvePeriod(q, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
      if ("error" in period) return { loaded: null, invalid: period.error, problem: null };
      // The trailing view is read only on its own tab.
      const [data, cohorts] = await Promise.all([loadPnl(tenantId, period), view === "cohorts" ? persistingCohorts(tenantId, period.basis) : Promise.resolve(null)]);
      return { loaded: { data, cohorts, query: { kind: period.kind, anchor: period.range.from.slice(0, 7), from: q.from ?? "", to: q.to ?? "", basis: period.basis } }, invalid: null, problem: null };
    } catch (error) {
      if (!(error instanceof PnlError)) throw error;
      return { loaded: null, invalid: null, problem: error.message };
    }
  })();
  // Until the period is worked out, the tabs keep the address's own filters (the same three, the same order).
  const asked = (tab: PnlTab) => {
    const params = new URLSearchParams(Object.entries(q).flatMap(([key, value]) => (typeof value === "string" && key !== "view" ? [[key, value]] : [])));
    if (tab !== "statement") params.set("view", tab);
    const text = params.toString();
    return text ? `/app/pnl?${text}` : "/app/pnl";
  };
  const early = [
    { key: "statement" as const, label: "Statement", href: asked("statement") },
    { key: "trend" as const, label: "Last six months", href: asked("trend") },
    { key: "cohorts" as const, label: "Persisting cost", href: asked("cohorts") },
  ];
  return (
    <AccountingPage
      step="pnl"
      info={<Suspense fallback={ACQUISITION_CONSEQUENCE}><PnlInfo read={read} /></Suspense>}
      tabs={<Suspense fallback={<ViewTabs label="Profit & loss" value={view} tabs={early} />}><PnlTabs read={read} view={view} /></Suspense>}
      actions={<Suspense fallback={<Button variant="outline" disabled><Download aria-hidden="true" />Download (CSV)</Button>}><PnlActions read={read} view={view} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <PnlBody read={read} view={view} />
      </StreamSection>
    </AccountingPage>
  );
}

type PnlRead = Promise<{
  loaded: { data: Awaited<ReturnType<typeof loadPnl>>; cohorts: Awaited<ReturnType<typeof persistingCohorts>> | null; query: { kind: PnlKind; anchor: string; from: string; to: string; basis: "accrual" | "cash" } } | null;
  invalid: string | null;
  problem: string | null;
}>;

async function PnlInfo({ read }: { read: PnlRead }) {
  const { loaded } = await read;
  return loaded ? `${BASIS_NOTE[loaded.data.basis]} ${ACQUISITION_CONSEQUENCE}` : ACQUISITION_CONSEQUENCE;
}

async function PnlTabs({ read, view }: { read: PnlRead; view: PnlTab }) {
  const { loaded } = await read;
  return loaded ? <ViewTabs label="Profit & loss" value={view} tabs={pnlTabs(loaded.query)} /> : null;
}

async function PnlActions({ read, view }: { read: PnlRead; view: PnlTab }) {
  const { loaded } = await read;
  return loaded ? <PnlDownload data={loaded.data} query={loaded.query} view={view} cohorts={loaded.cohorts} /> : null;
}

async function PnlBody({ read, view }: { read: PnlRead; view: PnlTab }) {
  const { loaded, invalid, problem } = await read;
  return invalid ? <ErrorState detail={invalid} />
    : loaded ? <PnlBoard data={loaded.data} query={loaded.query} view={view} cohorts={loaded.cohorts} />
    : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
}
