import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DispositionWizard } from "@/components/app/disposition-wizard";
import { VerificationPanel } from "@/components/app/verification-panel";
import { InboundStepBar } from "@/components/app/inbound/inbound-step-bar";

/**
 * The call (Inbound A, owner 2026-10-27): step 2, Verification, then step 3, Finish the call
 * (?step=finish). Was /app/inbound/<id>/verification and /app/inbound/<id>/disposition, which
 * forward here. Verification is open to owners, agents and screeners; recording how the call ended
 * stays with owners and agents (a screener passes the call to a licensed agent instead).
 */
export default async function InboundCallPage({ params, searchParams }: { params: Promise<{ workItemId: string }>; searchParams: Promise<{ step?: string }> }) {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound" description="Check each caller's details and record how the call ended." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Inbound" detail="Inbound callers are taken by owners, agents and screeners. Ask your owner if you should be one." />;
  const { workItemId } = await params;
  const { step } = await searchParams;
  const readOnly = guard.entitlement.status === "suspended" || guard.entitlement.status === "paused";

  if (step === "finish") {
    if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Finish the call" detail="A licensed agent records how the call ended. Pass the call to one from Verification." />;
    return <DispositionWizard workItemId={workItemId} readOnly={readOnly} stepBar={<InboundStepBar current={2} />} />;
  }
  return <><VerificationPanel workItemId={workItemId} readOnly={readOnly} canHandoff={guard.role === "assistant"} /></>;
}
