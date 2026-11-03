import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { HierarchyBoard } from "@/components/app/agency/hierarchy-board";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * AG-1.2 · Commissions › Hierarchy & overrides (owner 2026-11-03: the Team group went; the override is commission
 * money, so it sits after Producer pay). Owner, admin, bookkeeper; a manager sees his reports. `?issues=1` opens the
 * rows with a missing level or a negative spread (the strip's figures, the rail's badge).
 */
export default async function HierarchyPage({ searchParams }: { searchParams: Promise<{ issues?: string }> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Hierarchy & Overrides" description="Who reports to whom, and what the agency keeps on each producer." />;
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || guard.context.memberRole === "manager")) {
    return <RoleGateNotice featureLabel="Hierarchy & Overrides" detail="The owner, admins, managers and the bookkeeper see overrides." />;
  }
  const { issues } = await searchParams;
  return (
    <CommissionsPage
      step="hierarchy"
      titleInfo={<InfoTip label="About Hierarchy & overrides" side="right">Who reports to whom, and what the agency keeps on each producer&apos;s business this month. The override is computed — agency level minus the producer&apos;s level, per carrier — never typed. A missing level means no override until it is set; a negative spread means the agency pays out more than it receives.</InfoTip>}
    >
      <HierarchyBoard canEdit={guard.role === "owner" && guard.entitlement.access !== "read_only"} initialIssues={issues === "1"} />
    </CommissionsPage>
  );
}
