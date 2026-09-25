import { guardPage } from "@/lib/entitlements/guardPage";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DealFlowWorkspace } from "@/components/app/deal-flow-workspace";

export default async function DealFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("daily_deal_flow");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Daily deal flow" description="See every deal worked today, grouped by partner, with the written numbers your agent confirmed." />;
  if (!["owner", "producer"].includes(guard.role)) return <RoleGateNotice featureLabel="Daily deal flow" detail="Only owners and producers can review or edit the daily deal flow." />;
  const [params, timeZone] = await Promise.all([searchParams, getWorkspaceTimezone(guard.context.tenantId).catch(() => null)]);
  const focusLeadId = typeof params.focus_lead_id === "string" ? params.focus_lead_id : null;
  // "Today" is the agency's day when Settings › Agency profile stores a timezone, else the browser's.
  return <DealFlowWorkspace focusLeadId={focusLeadId} timeZone={timeZone} />;
}
