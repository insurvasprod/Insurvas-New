import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { NurtureWorkspace } from "@/components/app/nurture-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
export default async function NurturePage() { const guard = await guardPage("outbound_dialing"); if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Lead recycling" description="Reuse aged leads with history, caps, and fresh suppression screening." />; if (!["owner", "producer"].includes(guard.role)) return <RoleGateNotice featureLabel="Lead recycling" detail="Only owners and producers can reactivate nurture leads." />; return <NurtureWorkspace />; }
