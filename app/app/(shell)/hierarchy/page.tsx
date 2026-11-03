import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { HierarchyBoard } from "@/components/app/agency/hierarchy-board";

/** AG-1.2 · Team › Hierarchy & Overrides. Owner, admin, bookkeeper; a manager sees his reports. */
export default async function HierarchyPage() {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Hierarchy & Overrides" description="Who reports to whom, and what the agency keeps on each producer." />;
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || guard.context.memberRole === "manager")) {
    return <RoleGateNotice featureLabel="Hierarchy & Overrides" detail="The owner, admins, managers and the bookkeeper see overrides." />;
  }
  return <HierarchyBoard canEdit={guard.role === "owner"} />;
}
