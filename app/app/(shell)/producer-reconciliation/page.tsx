import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { ReconciliationBoard } from "@/components/app/agency/reconciliation-board";
import { Button } from "@/components/ui/button";
import { monthRange, producerPayFigures, type ProducerPayFigure } from "@/lib/commissions/producerPayFigures";

/**
 * AG-1.12 · Commissions › Producer pay. The owner, an admin or the bookkeeper.
 *
 * Board 14 (2026-11-03, light touch): "Run payouts" is the title line's one primary (it opens Producer payouts'
 * New run, where nothing is written until a run is committed); the list leads with Earned, Advanced, Charged back
 * and Owed per producer (reported basis, lib/commissions/producerPayFigures.ts), the three truths a switch away,
 * and the whole row opens the producer.
 */
export default async function ProducerReconciliationPage() {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer reconciliation" description="Expected, reported and received, per producer." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Producer reconciliation" detail="The owner, admins and the bookkeeper reconcile producer pay." />;
  // Both months the board's period switch offers; a read that fails shows "—", never $0.
  const figures = (offset: number) => {
    const { from, to } = monthRange(offset);
    return producerPayFigures({ tenantId: guard.context.tenantId, userId: guard.context.userId }, from, to).catch((error: unknown): ProducerPayFigure[] | null => {
      console.error("[producer pay] figures could not be read", error);
      return null;
    });
  };
  const [last, current] = await Promise.all([figures(-1), figures(0)]);
  return (
    <CommissionsPage step="reconciliation" actions={<Button asChild type="button"><Link href="/app/producer-payouts">Run payouts</Link></Button>}>
      <ReconciliationBoard canReview={guard.entitlement.access !== "read_only"} pay={{ last, this: current }} />
    </CommissionsPage>
  );
}
