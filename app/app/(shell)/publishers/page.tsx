import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { PartnersWorkspace } from "@/components/app/partners-workspace";

export default async function PublishersPage() {
  const guard = await guardPage("publisher_records");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partners" description="Manage publishers, marketing companies and affiliates." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Partners" detail="Partner records are managed by the account owner or bookkeeper." />;
  // Partners A (2026-10-25): on the dashboard's moving ribbon.
  return <DashboardStage ribbon><PartnersWorkspace readOnly={guard.entitlement.access === "read_only"} canManageProductConfig={guard.role === "owner"} /></DashboardStage>;
}
