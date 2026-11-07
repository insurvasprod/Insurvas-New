import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadServicing, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ServicingBoard } from "@/components/app/servicing-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { RetentionPage } from "@/components/app/retention/retention-page";

/**
 * Retention › Waiting on the carrier (the `payment_repair` feature; was "Servicing"). Every change asked of a
 * carrier (payment date, bank or card, mailed bill to bank draft, address), open until the next carrier file
 * proves it. Opening it checks the open requests against the latest files (the database decides). You chase
 * here; the work itself is on the case.
 *
 * Paper bill → bank (LA-5.5) was a second list of the clients on Cases › Paperwork (a mailed bill): one place to
 * work them since the critique of 2026-11-05 (E1), so its address opens that tab. Its call pages still answer.
 */
export default async function ServicingPage({ searchParams }: { searchParams: Promise<{ status?: string; view?: string }> }) {
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Waiting on the carrier" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Waiting on the carrier" detail="Only owners, producers and retention reps can open servicing requests." />;
  }
  // The board's chip (`?status=`) is read by the board itself, so it follows the address.
  const { view } = await searchParams;
  if (view === "campaign") redirect("/app/retention?step=paperwork&reason=mailed_bill");
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  const list = await loadServicing(viewer);

  return (
    <RetentionPage step="servicing" actions={readOnly || !list.available ? undefined : <Button asChild><Link href="/app/servicing/new">New request</Link></Button>}>
      {list.available ? (
        <ServicingBoard rows={list.rows} verifiedLast30={list.verifiedLast30} readOnly={readOnly} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={SERVICING_PENDING_MESSAGE} />
        </TableCard>
      )}
    </RetentionPage>
  );
}
