import { notFound, redirect } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A list's old page. There is no Lists page any more (manager 2026-10-29): a campaign holds its lists,
 * and everything this page showed — removed at import, not being served, the column map, health,
 * consent, claims, assigning — is on its campaign's page under Source. Old links land there.
 */
export default async function LeadListDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  if (!UUID.test(campaignId)) notFound();
  redirect(`/app/campaigns/${campaignId}`);
}
