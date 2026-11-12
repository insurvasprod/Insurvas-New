import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { NewHoldPage } from "@/components/app/compliance/compliance-settings-pages";
import { RouteSheet } from "@/components/app/route-sheet";

/** Place a legal hold, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its page. */
export default async function PlaceHoldSheet() {
  const title = "Place a hold";
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <RouteSheet title={title}><FeatureGateNotice guard={guard} featureLabel="Compliance settings" description="Deadlines, retention, holds, deletion and the transfer gate." /></RouteSheet>;
  }
  if (guard.role !== "owner") {
    return <RouteSheet title={title}><RoleGateNotice featureLabel="Compliance settings" detail="Only the agency owner can change compliance settings." /></RouteSheet>;
  }
  const readOnly = guard.entitlement.access === "read_only";
  return (
    <RouteSheet title={title}>
      <NewHoldPage readOnly={readOnly} />
    </RouteSheet>
  );
}
