import { notFound, redirect } from "next/navigation";

import { PartnerLeadRecord } from "@/components/partner/partner-lead-record";
import { resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";
import { getPartnerLeadDetail } from "@/lib/partnerLeads/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One lead's record, on its own page (owner, 30 Oct). It was a panel beside the board, which took
 * 30% of the row and squeezed the board as it opened.
 *
 * It reads through `getPartnerLeadDetail`, the same service the API uses, so the scoping proved in
 * `lib/partnerLeads/isolation.test.mjs` holds here without a second access path: a `partner_user`
 * asking for a colleague's lead gets "Lead not found", which this page turns into a 404 rather than
 * an error — a record you may not see and a record that does not exist look the same from outside.
 */
export default async function PartnerLeadRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ leadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ leadId }, query] = await Promise.all([params, searchParams]);
  const context = await resolvePartnerContext();
  if (!context) redirect("/partner/login");
  if (!UUID.test(leadId)) notFound();

  const detail = await getPartnerLeadDetail(context.tenantId, context.partnerId, leadId, {
    userId: context.userId,
    role: context.role,
  }).catch(() => null);
  if (!detail) notFound();

  // Back to the board the reader came from, in the view they had it in.
  const view = query.view === "table" ? "?view=table" : "";
  return <PartnerLeadRecord detail={detail} backHref={`/partner/pipeline${view}`} />;
}
