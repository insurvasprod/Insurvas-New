import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { REQUEST_TYPES, type RequestType } from "@/lib/retention/servicing";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ServicingNewRequest } from "@/components/app/retention/servicing-new-request";
import { NEW_REQUEST_SLOT } from "@/components/app/retention/servicing-shared";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { RouteSheet } from "@/components/app/route-sheet";

/**
 * A new servicing request, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its
 * page. The form's saves, on the page's title line there (StepSlotTarget), sit in the footer here.
 */
export default async function NewServicingRequestSheet({ searchParams }: { searchParams: Promise<{ carrier?: string; policy?: string; type?: string }> }) {
  const title = "New request";
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <RouteSheet title={title} wide><FeatureGateNotice guard={guard} featureLabel="Waiting on the carrier" description="Changes asked of the carrier, tracked until the next carrier file proves them." /></RouteSheet>;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RouteSheet title={title} wide><RoleGateNotice featureLabel="Waiting on the carrier" detail="Only owners, producers and retention reps can open servicing requests." /></RouteSheet>;
  }
  if (guard.entitlement.access === "read_only") {
    return <RouteSheet title={title} wide><RoleGateNotice featureLabel="Waiting on the carrier" detail="Waiting on the carrier is read-only on this plan, so new requests can't be opened." action={{ href: "/app/servicing", label: "Open Waiting on the carrier" }} /></RouteSheet>;
  }
  const { carrier, policy, type } = await searchParams;
  const policyNumber = (policy ?? "").trim().slice(0, 120);
  const initial = carrier && isRecordUuid(carrier) && policyNumber
    ? { carrierId: carrier, policyNumber, type: (REQUEST_TYPES as readonly string[]).includes(type ?? "") ? (type as RequestType) : null }
    : null;
  return (
    <RouteSheet title={title} wide footer={<div className="ml-auto"><StepSlotTarget id={NEW_REQUEST_SLOT} /></div>}>
      <ServicingNewRequest initial={initial} />
    </RouteSheet>
  );
}
