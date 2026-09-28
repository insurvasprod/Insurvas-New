import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PoliciesWorkspace } from "@/components/app/policies-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { guardPage } from "@/lib/entitlements/guardPage";

export default async function PoliciesPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const readOnly = guard.entitlement.access === "read_only";
  // The header lives in the workspace: its Import and Add actions open the workspace's dialogs.
  return <PoliciesWorkspace readOnly={readOnly} />;
}
