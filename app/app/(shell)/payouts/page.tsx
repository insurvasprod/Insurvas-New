import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listRuns, PayoutError } from "@/lib/accounting/payoutStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { PayoutActions, PayoutsBoard } from "@/components/app/accounting/payouts-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Partner payouts (LA-7.4, Notion sprint). What each partner is owed, itemised from its
 * terms, reviewed as a draft and published to the partner's portal. Owner and bookkeeper only.
 *
 * 2026-11-03 (owner): moved from Partners into Accounting, where Module 7 puts it, at the same address. A run
 * opens as its own page; `?open=<id>` (the P&L's drill-through) lands there; `?status=` is a figure's rows.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ open?: string; status?: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Partner payouts" description="What each partner is owed, from the ledger." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Partner payouts" detail="Only owners and bookkeepers can see what partners are paid." />;
  }
  const [{ open, status }, records] = await Promise.all([searchParams, guardPage("publisher_records")]);
  if (open && UUID.test(open)) redirect(`/app/payouts/${open}`);
  let loaded: Awaited<ReturnType<typeof listRuns>> | null = null;
  let problem: string | null = null;
  try {
    loaded = await listRuns(guard.context.tenantId);
  } catch (error) {
    if (!(error instanceof PayoutError)) throw error;
    problem = error.message;
  }
  const readOnly = guard.entitlement.access === "read_only";
  return (
    <AccountingPage
      step="payouts"
      info="Each run is priced from the partner's terms, item by item at the rate in force on its date. Only you see a draft; publishing shows the statement in the partner's portal and books the cost. Nothing here moves money."
      actions={loaded ? <PayoutActions partners={loaded.partners} readOnly={readOnly} /> : undefined}
    >
      {loaded ? <PayoutsBoard runs={loaded.runs} partners={loaded.partners} readOnly={readOnly} status={status} recordLinks={records.entitled} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
