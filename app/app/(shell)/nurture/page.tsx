import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { NurtureWorkspace } from "@/components/app/nurture-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";
export default async function NurturePage() { const guard = await guardPage("outbound_dialing"); if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead recycling" description="Recycle aged leads with fresh suppression screening." />; if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Lead recycling" detail="Only owners and producers can reactivate nurture leads." />; if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead recycling" detail="In an agency, the owner and admins handle lead recycling." />; return <LeadsInPage step="recycle"><NurtureWorkspace /></LeadsInPage>; }
