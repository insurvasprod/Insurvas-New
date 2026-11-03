import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { RADAR_PENDING_MESSAGE } from "@/lib/retention/constants";
import { SORTS, type QueueSort } from "@/lib/retention/queue";
import { loadSaveQueue } from "@/lib/retention/queueStore";
import { closingSoon } from "@/lib/retention/reinstatementStore";
import Link from "next/link";
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
 * Gated on `chargeback_radar`; owner, producer (their own policies) and retention rep (the cards
 * assigned to them, LA-5.8).
 * Opening the page recomputes the scores only when a day has passed or a newer file arrived.
 */
export default async function SaveQueuePage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  // The three feature checks and the search params together (each guard is memoised for the request, so
  // they share the session, membership and entitlement reads); still decided in the order below.
  const [guard, servicing, reinstatement, { sort: sortParam }] = await Promise.all([guardPage("chargeback_radar"), guardPage("payment_repair"), guardPage("winback"), searchParams]);
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Save queue" description="Policies paying fine today that the radar says will stop, with the reason and the fix." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Save queue" detail="Only owners, producers and retention reps can view retention risk and the advance at risk." />;
  }

  // No sort in the address: the agency's default (LA-5.11).
  const asked: QueueSort | undefined = (SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as QueueSort) : undefined;
  // "Start the fix" opens an LA-5.4 servicing request, which is the `payment_repair` feature (`servicing`).
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  // LA-5.6: a reinstatement window about to close is pinned above everything else here (`reinstatement`).
  const [queue, closing] = await Promise.all([loadSaveQueue(viewer, asked), reinstatement.entitled ? closingSoon(viewer).catch(() => null) : Promise.resolve(null)]);

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Save queue" description="Policies paying fine today that the radar says will stop." />
      {closing ? (
        <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">
          {closing === 1 ? "1 reinstatement window closes" : `${closing} reinstatement windows close`} within days, and then the policy is gone for good. <Link href="/app/reinstatement" className="font-semibold underline">Work it now</Link>
        </p>
      ) : null}
      {queue.available ? (
        <SaveQueueBoard queue={queue} sort={asked ?? queue.settings.queueDefaultSort} readOnly={guard.entitlement.access === "read_only"} canStartFix={servicing.entitled && servicing.entitlement.access !== "read_only"} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={RADAR_PENDING_MESSAGE} />
        </TableCard>
      )}
    </div>
  );
}
