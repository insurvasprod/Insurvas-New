import { guardPage } from "@/lib/entitlements/guardPage";
import { ConsentLockerWorkspace } from "@/components/app/consent-locker-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";

/**
 * LA-2.6 · `/app/consent`.
 *
 * The table, the ingest writer, the claim job and the dialer's read all existed. What did not was
 * a way to find one certificate months later, when a complaint names one person — which is the only
 * moment a consent locker is ever used.
 */
export default async function ConsentPage() {
  const guard = await guardPage("consent_locker");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Consent locker"
        description="Every consent certificate captured with a posted lead, searchable by name or number, with the copy we hold ourselves."
      />
    );
  if (!["owner", "producer", "assistant"].includes(guard.role))
    return <RoleGateNotice featureLabel="Consent locker" detail="Only owners, producers and assistants can open the consent locker." />;

  // The header is drawn by the workspace, so the first load can show the one page skeleton; its
  // Export follows the list's filters (with none set it is the whole locker).
  return <ConsentLockerWorkspace />;
}
