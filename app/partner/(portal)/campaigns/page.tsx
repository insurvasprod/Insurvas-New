import { PartnerCampaigns } from "@/components/partner/partner-campaigns";

import { partnerPageContext } from "../page-gate";

/** Partner portal › Campaigns (roles board P2). Marketing partners only (lib/partnerAuth/portalAccess.ts). */
export default async function PartnerCampaignsPage() {
  await partnerPageContext("campaigns");
  return <PartnerCampaigns />;
}
