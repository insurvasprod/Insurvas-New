import { guardPage } from "@/lib/entitlements/guardPage";
import { UpgradePrompt } from "@/components/app/upgrade-prompt";
import { LeadWorkspace } from "@/components/app/lead-workspace";

export default async function LeadsPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <UpgradePrompt featureLabel="Lead workspace" description="Capture, filter and move leads using your platform template." planCode={guard.entitlement.plan_code} />;
  return <LeadWorkspace />;
}
