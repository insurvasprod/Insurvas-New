import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PartnersWorkspace } from "@/components/app/partners-workspace";

export default async function PublishersPage() {
  const guard = await guardPage("publisher_records");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partners" description="Manage publishers, marketing companies and affiliates without losing their history." />;
  if (guard.role !== "owner" && guard.role !== "bookkeeper") return <RoleGateNotice featureLabel="Partners" detail="Partner records are managed by the account owner or bookkeeper." />;
  return <PartnersWorkspace readOnly={guard.entitlement.access === "read_only"} canManageProductConfig={guard.role === "owner"} />;
}
