import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
// LA-8.2: times show in the viewer's own display timezone, else the agency's.
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { getDealDayZone } from "@/lib/dealFlow/dayZone";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DealFlowWorkspace } from "@/components/app/deal-flow-workspace";

export default async function DealFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("daily_deal_flow");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Daily deal flow" description="Every deal worked today, by partner, with confirmed numbers." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Daily deal flow" detail="Only owners and producers can review or edit the daily deal flow." />;
  const [params, timeZone, dayZone] = await Promise.all([
    searchParams,
    getViewerTimezone(guard.context.tenantId, guard.context.userId).catch(() => null),
    getDealDayZone(guard.context.tenantId).catch(() => null),
  ]);
  const focusLeadId = typeof params.focus_lead_id === "string" ? params.focus_lead_id : null;
  // "Today" is the day the deals are filed on: the agency's timezone, else its partners' shared one, else the
  // browser's (lib/dealFlow/dayZone.ts). Times still show in the viewer's own zone (`timeZone`, LA-8.2).
  // Leads A2 (2026-10-25): on the dashboard's static stage backdrop.
  return (
    <>
      <DealFlowWorkspace focusLeadId={focusLeadId} timeZone={timeZone} dayZone={dayZone} />
    </>
  );
}
