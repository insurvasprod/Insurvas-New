import { PartnerLinks } from "@/components/partner/partner-links";

import { partnerPageContext } from "../page-gate";

/** Partner portal › My links (roles board P3). Affiliates only (lib/partnerAuth/portalAccess.ts). */
export default async function PartnerLinksPage() {
  await partnerPageContext("links");
  return <PartnerLinks />;
}
