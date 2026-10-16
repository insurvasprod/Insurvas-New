import { guardPage } from "@/lib/entitlements/guardPage";
import { resolvePeriod, type PeriodKind as PnlKind } from "@/lib/accounting/pnlCore";
import { loadPnl, PnlError, reportingSettings } from "@/lib/accounting/pnlStore";
import { contractors } from "@/lib/accounting/taxStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PnlBoard } from "@/components/app/accounting/pnl-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Profit & loss (LA-7.7, Notion sprint). Did this month make money — and what did a policy
 * that lasts really cost. Computed live from the ledgers. Owner and bookkeeper only.
 */
export default async function PnlPage({ searchParams }: { searchParams: Promise<{ kind?: string; anchor?: string; from?: string; to?: string; basis?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Profit & loss" description="Money in, money out, and what a lasting policy really cost." />;
  }
  if (!["owner", "bookkeeper"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Profit & loss" detail="Only owners and bookkeepers can see the agency's profit and loss." />;
  }
  const q = await searchParams;
  const tenantId = guard.context.tenantId;
  let loaded: { data: Awaited<ReturnType<typeof loadPnl>>; taxMissing: number; query: { kind: PnlKind; anchor: string; from: string; to: string; basis: "accrual" | "cash" } } | null = null;
  let invalid: string | null = null;
  let problem: string | null = null;
  try {
    const settings = await reportingSettings(tenantId);
    const period = resolvePeriod(q, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
    if ("error" in period) invalid = period.error;
    else {
      // LA-7.8: missing W-9s and tax IDs surface during the year, while they are still easy to chase.
      const [data, tax] = await Promise.all([loadPnl(tenantId, period), contractors(tenantId, new Date().getUTCFullYear()).catch(() => null)]);
      loaded = { data, taxMissing: tax?.missingCount ?? 0, query: { kind: period.kind, anchor: period.range.from.slice(0, 7), from: q.from ?? "", to: q.to ?? "", basis: period.basis } };
    }
  } catch (error) {
    if (!(error instanceof PnlError)) throw error;
    problem = error.message;
  }
  const content = invalid ? <ErrorState detail={invalid} />
    : loaded ? <PnlBoard data={loaded.data} query={loaded.query} taxMissing={loaded.taxMissing} />
    : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Profit & loss" description="Money in, money out, and what is left." />
      {content}
    </div>
  );
}
