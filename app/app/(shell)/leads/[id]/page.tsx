import { LeadDetailWorkspace } from "@/components/app/lead-detail-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { DashboardStage } from "@/components/ui/dashboard-stage";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead workspace" description="Open the submitted application, verification history, and every lead event in one place." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Lead workspace" detail="Only owners, producers, and assistants can open lead workspaces." />;
  // Leads A3 (2026-10-25): on the dashboard's static stage backdrop.
  return <DashboardStage><div className="portal-lead-detail-page"><LeadDetailWorkspace leadId={(await params).id} /></div></DashboardStage>;
}
