import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { NewDeletionRequestForm } from "@/components/app/compliance/deletion-requests-board";
import { RouteSheet } from "@/components/app/route-sheet";

/** Log a deletion request, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its page. */
export default async function NewDeletionRequestSheet() {
  const title = "Log a deletion request";
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <RouteSheet title={title}><FeatureGateNotice guard={guard} featureLabel="Deletion requests" description="When one person asks to be deleted: verify, hold, delete and certify." /></RouteSheet>;
  if (!actAsPage(guard, ["owner", "producer"])) return <RouteSheet title={title}><RoleGateNotice featureLabel="Deletion requests" detail="Only owners and producers can see consumer deletion requests." /></RouteSheet>;
  if ((await scopeFor(guard.context)) !== null) return <RouteSheet title={title}><RoleGateNotice reason="agency" featureLabel="Deletion requests" detail="In an agency, the owner and admins handle deletion requests." /></RouteSheet>;
  if (guard.entitlement.access === "read_only") return <RouteSheet title={title}><RoleGateNotice featureLabel="Deletion requests" detail="This plan is read-only here: requests can be read, not logged." /></RouteSheet>;
  return (
    <RouteSheet title={title}>
      <NewDeletionRequestForm />
    </RouteSheet>
  );
}
