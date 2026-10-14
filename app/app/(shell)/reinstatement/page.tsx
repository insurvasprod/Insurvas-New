import { guardPage } from "@/lib/entitlements/guardPage";
import { loadReinstatement, REINSTATEMENT_PENDING_MESSAGE } from "@/lib/retention/reinstatementStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ReinstatementBoard } from "@/components/app/reinstatement-board";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Book › Reinstatement (LA-5.6, Notion sprint; the `winback` feature). Lapsed policies the carrier
 * will still take back, fewest days first — the one place in retention where a missed deadline is
 * permanent. Opening the page asks the database to open new cases, close reinstated ones from the
 * carrier file, expire closed windows and send the countdown alerts.
 */
export default async function ReinstatementPage() {
  const guard = await guardPage("winback");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Reinstatement" description="Lapsed policies the carrier will still take back, with the days left to do it." />;
  }
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Reinstatement" detail="Only owners and producers can work reinstatement cases." />;
  }
  const data = await loadReinstatement({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role });
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Reinstatement" description="Lapsed policies the carrier will still take back, fewest days left first." />
      {data.available ? (
        <ReinstatementBoard data={data} readOnly={guard.entitlement.access === "read_only"} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={REINSTATEMENT_PENDING_MESSAGE} />
        </TableCard>
      )}
    </div>
  );
}
