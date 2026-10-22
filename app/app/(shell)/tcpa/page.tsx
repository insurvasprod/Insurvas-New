import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { SuppressionWorkspace } from "@/components/app/suppression-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * LA-2.3 · `/app/tcpa`.
 *
 * The suppression machinery was finished and had no front door. `suppress_phone` and
 * `is_phone_suppressed` both existed, three code paths wrote through them, and the dialer refused
 * suppressed numbers correctly — but this menu entry pointed at a route that was never built, so
 * nobody could see the list, search it, or add to it when a complaint came in by email.
 */
export default async function TcpaPage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="TCPA / DNC"
        description="Numbers you must never call, and a check before dialling."
      />
    );
  // A setter needs to be able to answer "are we allowed to call this person" mid-shift, so reading
  // is theirs. Adding is not: a suppression cannot be undone without a migration.
  if (!actAsPage(guard, ["owner", "producer", "assistant", "setter"]))
    return <RoleGateNotice featureLabel="TCPA / DNC" detail="Your role cannot see the suppression list." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="TCPA / DNC" detail="In an agency, the owner and admins keep the suppression list. The dialer still checks every number before it rings." />;

  // The header is drawn by the workspace: its Suppress a number action opens the workspace's form.
  return <SuppressionWorkspace />;
}
