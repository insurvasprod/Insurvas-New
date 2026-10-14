import { guardPage } from "@/lib/entitlements/guardPage";
import { RADAR_PENDING_MESSAGE } from "@/lib/retention/constants";
import { SORTS, type QueueSort } from "@/lib/retention/queue";
import { loadSaveQueue } from "@/lib/retention/queueStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { SaveQueueBoard } from "@/components/app/save-queue-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Book › Save queue (LA-5.3, Notion sprint). Policies paying perfectly well right now that the
 * chargeback radar (LA-5.1/5.2) says will stop — the reason, at most two fixes, what each is worth.
 * A prediction, so it lives apart from Lapse risk (LA-4.16), which shows what has already happened.
 *
 * Gated on `chargeback_radar`; owner and producer (a producer's queue holds their own policies).
 * Opening the page recomputes the scores only when a day has passed or a newer file arrived.
 */
export default async function SaveQueuePage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Save queue" description="Policies paying fine today that the radar says will stop, with the reason and the fix." />;
  }
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Save queue" detail="Only owners and producers can view retention risk and commission exposure." />;
  }

  const { sort: sortParam } = await searchParams;
  const sort: QueueSort = (SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as QueueSort) : "value";
  const queue = await loadSaveQueue({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role }, sort);

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Save queue" description="Policies paying fine today that the radar says will stop." />
      {queue.available ? (
        <SaveQueueBoard queue={queue} sort={sort} readOnly={guard.entitlement.access === "read_only"} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={RADAR_PENDING_MESSAGE} />
        </TableCard>
      )}
    </div>
  );
}
