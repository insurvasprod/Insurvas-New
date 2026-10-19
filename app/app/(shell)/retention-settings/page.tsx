import { guardPage } from "@/lib/entitlements/guardPage";
import { HubError, loadHub, type Hub } from "@/lib/retention/settingsHubStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionSettingsBoard } from "@/components/app/retention/retention-settings-board";
import { SectionLastChanged } from "@/components/app/settings/last-changed";
import { SettingsTrail } from "@/components/app/settings/settings-trail";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Settings › Retention (LA-5.11, Notion sprint). Every number the radar, the queue and the campaigns
 * read, in one place, with an audit trail. Beside the sales settings (LA-3.17) and carrier rules
 * (LA-4.17), not inside them: carrier windows are linked there, never edited here. Owner only.
 */
export default async function RetentionSettingsPage() {
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
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <SettingsTrail label="Retention" />
      <div>
        <PageHeader title="Retention settings" description="Weights, thresholds, cooling-off periods and the holdout." />
        <SectionLastChanged sectionKey="retention" />
      </div>
      {hub ? (
        <RetentionSettingsBoard hub={hub} canEdit={guard.entitlement.access !== "read_only"} />
      ) : (
        <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
      )}
    </div>
  );
}
