import { guardPage } from "@/lib/entitlements/guardPage";
import { HubError, loadHub, type Hub } from "@/lib/retention/settingsHubStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionWeightsBoard } from "@/components/app/retention/retention-weights-board";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Settings › Retention › Scoring weights (LA-5.11): the seven signal weights on their own page, opened
 * from Start here. Previewed before a save; a save is a new version. Owner only, like the hub.
 */
export default async function RetentionWeightsPage() {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Retention settings" description="Weights, thresholds, cooling-off periods and the holdout." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Retention settings" detail="Only the owner changes how the radar scores and who works retention." />;
  }
  let hub: Hub | null = null;
  let problem: string | null = null;
  try {
    hub = await loadHub(guard.context.tenantId);
  } catch (error) {
    if (!(error instanceof HubError)) throw error;
    problem = error.message;
  }
  return (
    <SettingsRouteFrame sectionId="retention">
      <div className="flex min-h-0 flex-grow flex-col gap-4">
      {hub ? (
        <RetentionWeightsBoard weights={hub.weights} version={hub.weightVersion} isPlatform={hub.weightIsPlatform} platformWeights={hub.platformWeights} canEdit={guard.entitlement.access !== "read_only"} />
      ) : (
        <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
      )}
      </div>
    </SettingsRouteFrame>
  );
}
