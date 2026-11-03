import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplianceSettingsBoard } from "@/components/app/compliance/compliance-settings";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";

/**
 * Compliance › Settings (LA-6.8, Notion sprint). Everything LA-6 reads, in one place; the tenant
 * admin's. Calling windows, carrier windows, screening vendors, scripts and disclosures belong to
 * their own screens and are linked from here, never edited here.
 */
export default async function ComplianceSettingsPage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Compliance settings" description="Deadlines, retention, holds, deletion and the transfer gate." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Compliance settings" detail="Only the agency owner can change compliance settings." />;
  }
  return (
    // The one Settings layout: header, breadcrumb and menu come from the frame (settings-shell plan,
    // Task 6); this page keeps its gates above and draws only its board.
    <SettingsRouteFrame sectionId="compliance">
      <div className="flex min-h-0 flex-grow flex-col gap-4">
      <ComplianceSettingsBoard readOnly={guard.entitlement.access === "read_only"} />
      </div>
    </SettingsRouteFrame>
  );
}
