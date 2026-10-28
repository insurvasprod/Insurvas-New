import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
// LA-8.2: times show in the viewer's own display timezone, else the agency's.
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DealFlowWorkspace } from "@/components/app/deal-flow-workspace";

export default async function DealFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("daily_deal_flow");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Daily deal flow" description="Every deal worked today, by partner, with confirmed numbers." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Daily deal flow" detail="Only owners and producers can review or edit the daily deal flow." />;
  const [params, timeZone] = await Promise.all([searchParams, getViewerTimezone(guard.context.tenantId, guard.context.userId).catch(() => null)]);
  const focusLeadId = typeof params.focus_lead_id === "string" ? params.focus_lead_id : null;
  // "Today" is the agency's day when Settings › Agency profile stores a timezone, else the browser's.
  // Leads A2 (2026-10-25): on the dashboard's static stage backdrop.
  return (
    <>
      <DealFlowWorkspace focusLeadId={focusLeadId} timeZone={timeZone} />
    </>
  );
}
