import { guardPage } from "@/lib/entitlements/guardPage";
import { UpgradePrompt } from "@/components/app/upgrade-prompt";
import { DialerPreflight } from "@/components/app/dialer-preflight";

export default async function DialerPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <UpgradePrompt featureLabel="Dialer" description="Every number is checked against the enabled DNC vendors before dialing." planCode={guard.entitlement.plan_code} />;
  return <DialerPreflight />;
}
