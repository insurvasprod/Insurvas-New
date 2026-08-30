import { guardPage } from "@/lib/entitlements/guardPage";
import { UpgradePrompt } from "@/components/app/upgrade-prompt";
import { TemplateSettings } from "@/components/app/template-settings";

export default async function SettingsPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <UpgradePrompt featureLabel="Template settings" description="Choose and customize the lead, pipeline and application template for your agency." planCode={guard.entitlement.plan_code} />;
  return <TemplateSettings />;
}
