import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CampaignWorkspace } from "@/components/app/campaign-workspace";

export default async function CampaignsPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Vendors & campaigns" description="Track who you buy leads from, what each batch cost, and what a usable lead really costs." />;
  // Owner and producer only, matching the routes this screen reads. The page shows spend and cost
  // per lead, so the gate here has to be the same one the API enforces — a screen that renders for
  // a role the API refuses is just a page of error toasts.
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Vendors & campaigns" detail="Only owners and producers can see lead spend and vendor costs." />;
  return <CampaignWorkspace />;
}
