import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DeadlinePage } from "@/components/app/compliance/compliance-settings-pages";
import { RouteSheet } from "@/components/app/route-sheet";

/** A new complaint deadline, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its page. */
export default async function NewDeadlineSheet({ searchParams }: { searchParams: Promise<{ regulator?: string }> }) {
  const title = "Add a deadline";
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <RouteSheet title={title}><FeatureGateNotice guard={guard} featureLabel="Compliance settings" description="Deadlines, retention, holds, deletion and the transfer gate." /></RouteSheet>;
  }
  if (guard.role !== "owner") {
    return <RouteSheet title={title}><RoleGateNotice featureLabel="Compliance settings" detail="Only the agency owner can change compliance settings." /></RouteSheet>;
  }
  const readOnly = guard.entitlement.access === "read_only";
  const { regulator } = await searchParams;
  return (
    <RouteSheet title={title}>
      <DeadlinePage regulator={null} preset={regulator?.toUpperCase() ?? null} readOnly={readOnly} />
    </RouteSheet>
  );
}
