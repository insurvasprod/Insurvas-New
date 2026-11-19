import { PartnerReferForm } from "@/components/partner/partner-refer-form";

import { partnerPageContext } from "../page-gate";

/**
 * Partner portal › Refer someone (affiliates) / Submit lead (marketing): the LA-1.8 short form, posted
 * through the portal's intake (/api/partner/referrals). Publishers send the full application instead.
 */
export default async function PartnerReferPage() {
  const context = await partnerPageContext("refer");
  return <PartnerReferForm partnerType={context.partnerType} partnerStatus={context.partnerStatus} />;
}
