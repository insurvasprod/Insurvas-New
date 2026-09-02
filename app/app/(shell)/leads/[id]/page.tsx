import { redirect } from "next/navigation";

import { LeadDetailWorkspace } from "@/components/app/lead-detail-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { getPartnerSession } from "@/lib/partnerAuth/requirePartner";
import { guardPage } from "@/lib/entitlements/guardPage";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (await getPartnerSession()) redirect("/partner");
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead workspace" description="Open the submitted application, verification history, and every lead event in one place." />;
  if (!["owner", "producer", "assistant"].includes(guard.role)) return <RoleGateNotice featureLabel="Lead workspace" detail="Only owners, producers, and assistants can open lead workspaces." />;
  return <LeadDetailWorkspace leadId={(await params).id} />;
}
