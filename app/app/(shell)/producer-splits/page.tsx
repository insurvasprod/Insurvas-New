import { guardPage } from "@/lib/entitlements/guardPage";
import { ProducerError, producersOverview, syncProducerLedger } from "@/lib/accounting/producerStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducersBoard } from "@/components/app/accounting/producers-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Producer splits (LA-7.5, Notion sprint). Each producer's share of the commission the
 * agency received, the chargebacks that come back with it, and their payout runs. Owner and
 * bookkeeper only; producers see their own balance at My balance.
 */
export default async function ProducerSplitsPage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Producer splits" description="What each producer is owed, and what they owe back." />;
  }
  if (!["owner", "bookkeeper"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Producer splits" detail="Only owners and bookkeepers can see every producer's balance." />;
  }
  let data: Awaited<ReturnType<typeof producersOverview>> | null = null;
  let problem: string | null = null;
  try {
    if (guard.entitlement.access !== "read_only") await syncProducerLedger(guard.context.tenantId);
    data = await producersOverview(guard.context.tenantId);
  } catch (error) {
    if (!(error instanceof ProducerError)) throw error;
    problem = error.message;
  }
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Producer splits" description="What each producer is owed — and what they owe back." />
      {data ? <ProducersBoard data={data} readOnly={guard.entitlement.access === "read_only"} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </div>
  );
}
