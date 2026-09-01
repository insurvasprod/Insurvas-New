import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { DialerPreflight } from "@/components/app/dialer-preflight";
import { RoleGateNotice } from "@/components/app/role-gate-notice";

export default async function DialerPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Dialer" description="Every number is checked against the enabled DNC vendors before dialing." />;
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Dialer" detail="Only owners and producers can place calls. Ask the account owner if you need a different role." />;
  }
  return <DialerPreflight readOnly={guard.entitlement.access === "read_only"} />;
}
