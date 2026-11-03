import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ActivityAgentDetail } from "@/components/app/activity-agent-detail";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { sharedPeriod } from "@/lib/reports/views";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reports › Team activity › an agent (foundation pass 2026-11-03): the panel that opened beside the Agents
 * table, as a page. The same gate as Team activity; /api/app/activity applies the same roles and narrows a
 * setter to their own rows on its own.
 */
export default async function ActivityAgentPage({ params, searchParams }: { params: Promise<{ agentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Team activity" description="Per-agent dialing activity, setter outcomes, and fresh-versus-recycled performance." />;
  if (!actAsPage(guard, ["owner", "producer", "setter"])) return <RoleGateNotice featureLabel="Team activity" detail="Only owners, producers, and setters have a dialing scorecard." />;
  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(agentId)) notFound();
  return (
    <ReportsPage view="activity" title="Agent">
      <ActivityAgentDetail agentId={agentId} role={guard.role} initialPeriod={sharedPeriod(query)} />
    </ReportsPage>
  );
}
