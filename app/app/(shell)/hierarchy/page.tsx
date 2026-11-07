import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { HierarchyBoard } from "@/components/app/agency/hierarchy-board";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * AG-1.2 · Reports › Hierarchy & overrides (owner 2026-11-05: "I don't think hierarchy and overrides should be here
 * at all. Put hierarchy and overrides on reports"; it was a Commissions step from 2026-11-03). Owner, admin,
 * bookkeeper; a manager sees his reports. `?issues=1` opens the rows with a missing level or a negative spread.
 */
export default async function HierarchyPage({ searchParams }: { searchParams: Promise<{ issues?: string }> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Hierarchy & Overrides" description="Who reports to whom, and what the agency keeps on each producer." />;
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || guard.context.memberRole === "manager")) {
    return <RoleGateNotice featureLabel="Hierarchy & Overrides" detail="The owner, admins, managers and the bookkeeper see overrides." />;
  }
  const { issues } = await searchParams;
  return (
    <ReportsPage
      view="hierarchy"
      info={<InfoTip label="About Hierarchy & overrides" side="right">Who reports to whom, and what the agency keeps on each producer&apos;s business this month. The override is computed — agency level minus the producer&apos;s level, per carrier — never typed. A missing level means no override until it is set; a negative spread means the agency pays out more than it receives.</InfoTip>}
    >
      <HierarchyBoard canEdit={guard.role === "owner" && guard.entitlement.access !== "read_only"} initialIssues={issues === "1"} />
    </ReportsPage>
  );
}
