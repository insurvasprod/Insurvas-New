import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplianceSettingsBoard } from "@/components/app/compliance/compliance-settings";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsTrail } from "@/components/app/settings/settings-trail";
import { SectionLastChanged } from "@/components/app/settings/last-changed";

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
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <SettingsTrail label="Compliance" />
      {/* LA-8.8: who last changed a setting here, beside the values (the page is owner-only, like the log). */}
      <div>
        <PageHeader title="Compliance settings" description="Deadlines, retention, holds, deletion and the transfer gate." />
        <SectionLastChanged sectionKey="compliance" />
      </div>
      <ComplianceSettingsBoard readOnly={guard.entitlement.access === "read_only"} />
    </div>
  );
}
