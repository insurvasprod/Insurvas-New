import { redirect } from "next/navigation";

import { PartnerPortalSectionPage } from "../section-page";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PartnerPipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A lead's record used to open as a panel on this page, so links already sent to partners carry
  // ?lead=<id> (the partner home's figures link that way too). They go to its page now.
  const query = await searchParams;
  const lead = Array.isArray(query.lead) ? query.lead[0] : query.lead;
  if (lead && UUID.test(lead)) redirect(`/partner/pipeline/${lead}`);
  return <PartnerPortalSectionPage section="pipeline" />;
}
