import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplianceSettingsBoard } from "@/components/app/compliance/compliance-settings";
import { SettingsSectionHeader, SettingsSectionProvider } from "@/components/app/settings/primitives";
import { SettingsPageFrame } from "@/components/app/settings/settings-page-frame";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { visibleSections } from "@/lib/settings/registry";
import { effectiveFeatures } from "@/lib/features/killSwitch";

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
  const granted = await effectiveFeatures(guard.entitlement.features, guard.context.tenantId);
  const settingsSections = visibleSections(SETTINGS_SECTIONS, granted, guard.role);
  return (
    <SettingsPageFrame sections={settingsSections} activeId="compliance">
      {/* LA-8.8: who last changed a setting here, beside the values (the page is owner-only, like the log). */}
      <SettingsSectionProvider value={{ title: "Compliance settings", description: "Deadlines, retention, holds, deletion and the transfer gate.", id: "compliance", history: true }}>
        <SettingsSectionHeader />
      </SettingsSectionProvider>
      <ComplianceSettingsBoard readOnly={guard.entitlement.access === "read_only"} />
    </SettingsPageFrame>
  );
}
