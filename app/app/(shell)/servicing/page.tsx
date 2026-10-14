import { guardPage } from "@/lib/entitlements/guardPage";
import { loadServicing, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ServicingBoard } from "@/components/app/servicing-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Book › Servicing (LA-5.4, Notion sprint; the `payment_repair` feature). Every change asked of a
 * carrier — payment date, bank or card, mailed bill to bank draft, address — from the moment it is
 * asked until the next carrier file proves it. "The carrier says done" is not the end: only the file
 * is. Opening the page checks the open requests against the latest files (the database decides).
 */
export default async function ServicingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Servicing" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  }
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Servicing" detail="Only owners and producers can open servicing requests." />;
  }
  const { status } = await searchParams;
  const list = await loadServicing({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Servicing" description="Changes asked of the carrier, open until the next carrier file shows them." />
      {list.available ? (
        <ServicingBoard rows={list.rows} carriers={list.carriers} verifiedLast30={list.verifiedLast30} initialStatus={status === "failed" || status === "verified" || status === "all" ? status : "open"} readOnly={guard.entitlement.access === "read_only"} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={SERVICING_PENDING_MESSAGE} />
        </TableCard>
      )}
    </div>
  );
}
