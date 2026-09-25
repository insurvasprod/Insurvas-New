import { guardPage } from "@/lib/entitlements/guardPage";
import { ConsentLockerWorkspace } from "@/components/app/consent-locker-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { sectionForPath } from "@/lib/menu/definition";

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

  return (
    <div className="m-stagger portal-consent-page">
      <PageHeader
        eyebrow={sectionForPath("/app/consent") ?? undefined}
        title="Consent locker"
        description={"The evidence that each lead agreed to be called — the words, the time, the address it came from, and who provided it."}
        actions={<Button variant="outline" asChild><a href="/api/app/consent?view=leads&format=csv">Export evidence</a></Button>}
      />
      <ConsentLockerWorkspace />
    </div>
  );
}
