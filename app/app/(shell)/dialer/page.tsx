import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { DialerPreflight } from "@/components/app/dialer-preflight";

export default async function DialerPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Dialer" description="Every number is checked against the enabled DNC vendors before dialing." />;
  return <DialerPreflight />;
}
