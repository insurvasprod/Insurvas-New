import { guardPage } from "@/lib/entitlements/guardPage";
import { SuppressionWorkspace } from "@/components/app/suppression-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";

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
        description="The numbers your agency must never call, why each one is on the list, and a check you can run before dialling."
      />
    );
  // A setter needs to be able to answer "are we allowed to call this person" mid-shift, so reading
  // is theirs. Adding is not: a suppression cannot be undone without a migration.
  if (!["owner", "producer", "assistant", "setter"].includes(guard.role))
    return <RoleGateNotice featureLabel="TCPA / DNC" detail="Your role cannot see the suppression list." />;

  // The header is drawn by the workspace: its Suppress a number action opens the workspace's form.
  return <SuppressionWorkspace />;
}
