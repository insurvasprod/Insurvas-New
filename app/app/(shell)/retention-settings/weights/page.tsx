import { guardPage } from "@/lib/entitlements/guardPage";
import { loadLadderRules } from "@/lib/retention/cases/rulesStore";
import { HubError, loadHub, type Hub } from "@/lib/retention/settingsHubStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionWeightsBoard } from "@/components/app/retention/retention-weights-board";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Settings › Retention › Radar › Scoring weights (LA-5.11): the seven signal weights on their own page, opened from
 * the Radar tab's Scoring weights row; the section's tabs lead back (round 7, owner pick 7·A, 2026-11-10). Previewed
 * before a save; a save is a new version. Owner only, like the section.
 */
export default async function RetentionWeightsPage() {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Retention settings" description="The ladder, who works retention, cooling-off periods, the radar and the holdout." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Retention settings" detail="Only the owner changes how the radar scores and who works retention." />;
  }
  let hub: Hub | null = null;
  let problem: string | null = null;
  const [loaded, ladder] = await Promise.all([
    loadHub(guard.context.tenantId).catch((error: unknown) => {
      if (!(error instanceof HubError)) throw error;
      return error;
    }),
    loadLadderRules(guard.context.tenantId),
  ]);
  if (loaded instanceof HubError) problem = loaded.message;
  else hub = loaded;
  return (
    <SettingsRouteFrame sectionId="retention">
      <div className="flex min-h-0 flex-grow flex-col gap-4">
      {hub ? (
        <RetentionWeightsBoard weights={hub.weights} version={hub.weightVersion} isPlatform={hub.weightIsPlatform} platformWeights={hub.platformWeights} canEdit={guard.entitlement.access !== "read_only"} off={ladder.disabled.length} reps={hub.reps.length} />
      ) : (
        <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
      )}
      </div>
    </SettingsRouteFrame>
  );
}
