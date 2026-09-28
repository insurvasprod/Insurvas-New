import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PartnersWorkspace } from "@/components/app/partners-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { guardPage } from "@/lib/entitlements/guardPage";

export default async function PublisherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardPage("publisher_records");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Partners"
        description="Manage publishers, marketing companies and affiliates without losing their history."
      />
    );
  }
  if (guard.role !== "owner" && guard.role !== "bookkeeper") {
    return (
      <RoleGateNotice
        featureLabel="Partners"
        detail="Partner records are managed by the account owner or bookkeeper."
      />
    );
  }

  return (
    <PartnersWorkspace
      readOnly={guard.entitlement.access === "read_only"}
      canManageProductConfig={guard.role === "owner"}
      initialSelectedId={(await params).id}
      detailOnly
    />
  );
}
