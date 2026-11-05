import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { REQUEST_TYPES, type RequestType } from "@/lib/retention/servicing";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { ServicingNewRequest } from "@/components/app/retention/servicing-new-request";

/**
 * Retention › Servicing › New request (LA-5.4; SvA 2026-11-05, was two pop-ups). Find the policy, pick what
 * changes, fill in the request (ServicingRequestForm). `?carrier=&policy=&type=` fills it in (Try again on a
 * failed request). Not for a read-only plan.
 */
export default async function NewServicingRequestPage({ searchParams }: { searchParams: Promise<{ carrier?: string; policy?: string; type?: string }> }) {
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Servicing" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Servicing" detail="Only owners, producers and retention reps can open servicing requests." />;
  }
  if (guard.entitlement.access === "read_only") {
    return <RoleGateNotice featureLabel="Servicing" detail="Servicing is read-only on this plan, so new requests can't be opened." action={{ href: "/app/servicing", label: "Open Servicing" }} />;
  }
  const { carrier, policy, type } = await searchParams;
  const policyNumber = (policy ?? "").trim().slice(0, 120);
  const initial = carrier && isRecordUuid(carrier) && policyNumber
    ? { carrierId: carrier, policyNumber, type: (REQUEST_TYPES as readonly string[]).includes(type ?? "") ? (type as RequestType) : null }
    : null;

  return (
    <RetentionPage step="servicing" title="New request" breadcrumbs={retentionTrail("servicing", "New request")}>
      <ServicingNewRequest initial={initial} />
    </RetentionPage>
  );
}
