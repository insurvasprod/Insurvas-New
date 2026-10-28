import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listRuns, PayoutError } from "@/lib/accounting/payoutStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PayoutsBoard } from "@/components/app/accounting/payouts-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { DashboardStage } from "@/components/ui/dashboard-stage";

/**
 * Partners › Payout runs (LA-7.4, Notion sprint). What each partner is owed, itemised from its
 * terms, reviewed as a draft and published to the partner's portal. Owner and bookkeeper only.
 */
export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Payout runs" description="What each partner is owed, from the ledger." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Payout runs" detail="Only owners and bookkeepers can see what partners are paid." />;
  }
  const [{ open }, records] = await Promise.all([searchParams, guardPage("publisher_records")]);
  let loaded: Awaited<ReturnType<typeof listRuns>> | null = null;
  let problem: string | null = null;
  try {
    loaded = await listRuns(guard.context.tenantId);
  } catch (error) {
    if (!(error instanceof PayoutError)) throw error;
    problem = error.message;
  }
  // Partners A (2026-10-25): on the dashboard's static stage backdrop.
  return (
    <DashboardStage>
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Payout runs" description="What each partner is owed — and the statement they see." />
      {loaded ? <PayoutsBoard runs={loaded.runs} partners={loaded.partners} readOnly={guard.entitlement.access === "read_only"} openId={open ?? null} recordLinks={records.entitled} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </div>
    </DashboardStage>
  );
}
