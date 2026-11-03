import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { InboundHome } from "@/components/app/inbound/inbound-home";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

/**
 * Inbound (Inbound A, owner 2026-10-27): the agent's page. A one-time setup, then step 1, Take a
 * caller. The every-transfer table that lived here (filters, Today by partner, recovery) is Team ›
 * All callers at /app/inbound/team?tab=all.
 */
export default async function InboundPage() {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound" description="Take callers your partners transfer, check their details and record how each call ended." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Inbound" detail="Inbound callers are taken by owners, agents and screeners. Ask your owner if you should be one." />;
  // Solo mode: no Team to open; the header links to All callers (the workspace's transfer history) instead.
  const solo = await isSoloWorkspace(guard.context.tenantId);
  return (
    <>
      <InboundHome currentUserId={guard.context.userId} readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} canSeeTeam solo={solo} />
    </>
  );
}
