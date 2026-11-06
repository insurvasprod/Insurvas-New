import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { NewCase } from "@/components/app/retention/new-case";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";

/**
 * Retention › Cases › New case (walk 2026-11-05; docs/retention/SPEC.md §3 `payment_date_change`: "manual only:
 * the client asks"). A form page, not a pop-up (owner's rule: list → detail → form pages). Not for a read-only plan.
 */
export default async function NewRetentionCasePage() {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Retention" description="Every policy the carrier files flag, at its risk point, with what to do." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Retention" detail="Only owners, producers and retention reps work retention cases." />;
  if (guard.entitlement.access === "read_only") {
    return <RoleGateNotice featureLabel="Retention" detail="Retention is read-only on this plan, so new cases can't be opened." action={{ href: "/app/retention", label: "Open Cases" }} />;
  }
  return (
    <RetentionPage step="cases" title="New case" breadcrumbs={retentionTrail("cases", "New case")}>
      <NewCase />
    </RetentionPage>
  );
}
