import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RecordTypePage } from "@/components/app/compliance/compliance-settings-pages";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";

/** Settings › Compliance › Records & purge › one record type's retention rules (LA-6.6 / LA-6.8). Owner only, like the settings page. */
export default async function RetentionRulePage({ params }: { params: Promise<{ recordType: string }> }) {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Compliance settings" description="Deadlines, retention, holds, deletion and the transfer gate." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Compliance settings" detail="Only the agency owner can change compliance settings." />;
  }
  const readOnly = guard.entitlement.access === "read_only";
  const { recordType } = await params;
  return (
    <SettingsRouteFrame sectionId="compliance">
      <div className="flex min-h-0 flex-grow flex-col gap-4">
        <RecordTypePage recordType={decodeURIComponent(recordType)} readOnly={readOnly} />
      </div>
    </SettingsRouteFrame>
  );
}
