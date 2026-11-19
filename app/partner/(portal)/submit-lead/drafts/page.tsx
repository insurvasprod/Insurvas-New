import { PartnerSubmitDrafts } from "@/components/partner/partner-submit-drafts";

import { partnerPageContext } from "../../page-gate";

export default async function SubmitLeadDraftsPage() {
  // Drafts belong to the full application, which an affiliate does not get (portalAccess.ts).
  await partnerPageContext("submit");
  return <div className="portal-partner-submit-page flex min-h-0 flex-1 flex-col"><PartnerSubmitDrafts /></div>;
}
