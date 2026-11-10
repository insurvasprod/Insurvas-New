import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { BASIS_NOTE, resolvePeriod, type PeriodKind as PnlKind } from "@/lib/accounting/pnlCore";
import { ACQUISITION_CONSEQUENCE } from "@/lib/accounting/expensesCore";
import { pnlTabs, type PnlTab } from "@/lib/accounting/pnlLinks";
import { loadPnl, persistingCohorts, PnlError, reportingSettings } from "@/lib/accounting/pnlStore";
import { contractors } from "@/lib/accounting/taxStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PnlBoard } from "@/components/app/accounting/pnl-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Profit & loss (LA-7.7, Notion sprint). Did this month make money — and what did a policy
 * that lasts really cost. Computed live from the ledgers. Owner and bookkeeper only.
 *
 * Foundation pass (2026-11-03): Statement · Last six months are the step's tabs on the title line
 * (`?view=trend`); the basis, acquisition-only and threshold sentences are the title's (i).
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
  let loaded: { data: Awaited<ReturnType<typeof loadPnl>>; cohorts: Awaited<ReturnType<typeof persistingCohorts>> | null; taxMissing: number; query: { kind: PnlKind; anchor: string; from: string; to: string; basis: "accrual" | "cash" } } | null = null;
  let invalid: string | null = null;
  let problem: string | null = null;
  try {
    const settings = await reportingSettings(tenantId);
    const period = resolvePeriod(q, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
    if ("error" in period) invalid = period.error;
    else {
      // LA-7.8: missing W-9s and tax IDs surface during the year, while they are still easy to chase.
      // The trailing view is read only on its own tab.
      const [data, tax, cohorts] = await Promise.all([loadPnl(tenantId, period), contractors(tenantId, new Date().getUTCFullYear()).catch(() => null), view === "cohorts" ? persistingCohorts(tenantId, period.basis) : Promise.resolve(null)]);
      loaded = { data, cohorts, taxMissing: tax?.missingCount ?? 0, query: { kind: period.kind, anchor: period.range.from.slice(0, 7), from: q.from ?? "", to: q.to ?? "", basis: period.basis } };
    }
  } catch (error) {
    if (!(error instanceof PnlError)) throw error;
    problem = error.message;
  }
  const content = invalid ? <ErrorState detail={invalid} />
    : loaded ? <PnlBoard data={loaded.data} query={loaded.query} view={view} taxMissing={loaded.taxMissing} cohorts={loaded.cohorts} />
    : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  const info = loaded
    ? `${BASIS_NOTE[loaded.data.basis]} ${ACQUISITION_CONSEQUENCE} Under ${loaded.data.settings.threshold} policies the figures show counts, not a rate. Reported and received are never added together; every line opens its entries.`
    : undefined;
  return (
    <AccountingPage step="pnl" info={info} tabs={loaded ? <ViewTabs label="Profit & loss" value={view} tabs={pnlTabs(loaded.query)} /> : undefined}>
      {content}
    </AccountingPage>
  );
}
