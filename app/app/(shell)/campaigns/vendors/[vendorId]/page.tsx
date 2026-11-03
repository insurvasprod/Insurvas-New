import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CampaignWorkspace } from "@/components/app/campaign-workspace";
import { LeadsInPage } from "@/components/app/lead-sources/leads-in";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = ["campaigns", "scorecard", "settings"] as const;

/**
 * Source › a vendor (owner pick C, 2026-10-30, board LirE6): its campaigns, its scorecard (cost per
 * issued, speed to lead, consent) and its Settings, as tabs (`?tab=scorecard|settings`). Opened from
 * the Vendor filter and from Manage vendors. Same gate as Vendors & campaigns.
 */
export default async function VendorPage({ params, searchParams }: { params: Promise<{ vendorId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Vendors & campaigns" description="Track lead vendors, batch costs and cost per usable lead." />;
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Vendors & campaigns" detail="Only owners and producers can see lead spend and vendor costs." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Vendors & campaigns" detail="In an agency, the owner and admins handle vendors and lead spend." />;
  const [{ vendorId }, { tab }] = await Promise.all([params, searchParams]);
  if (!UUID.test(vendorId)) notFound();
  const initialVendorTab = TABS.find((item) => item === tab) ?? "campaigns";
  return (
    <LeadsInPage step="source" ownContinue>
      <CampaignWorkspace embedded vendorId={vendorId} initialVendorTab={initialVendorTab} readOnly={guard.entitlement.access === "read_only"} />
    </LeadsInPage>
  );
}
