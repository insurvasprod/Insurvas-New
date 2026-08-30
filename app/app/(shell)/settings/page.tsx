import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { TemplateSettings } from "@/components/app/template-settings";

export default async function SettingsPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Template settings" description="Choose and customize the lead, pipeline and application template for your agency." />;
  return <TemplateSettings />;
}
