import { PartnerDealFlow } from "@/components/partner/partner-deal-flow";
import { partnerPageContext } from "../page-gate";
import { resolveDay, todayIn } from "@/lib/partnerDealFlow/localDay";

/**
 * Partner portal › Daily deal flow. One day of what the agency did with the leads this partner
 * sent. Both roles; who sees which rows is decided by the portal's existing rule
 * (`lib/partnerLeads/scope.ts`), inside the read.
 *
 * The day is resolved here rather than in the component so the first paint is already the right
 * day — and so a `?day=` that is stale, malformed or in the future lands on today instead of
 * flashing an error.
 */
export default async function PartnerDealFlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Publishers, and affiliates with more than one person (lib/partnerAuth/portalAccess.ts).
  const context = await partnerPageContext("deal-flow");
  const query = await searchParams;
  const one = (key: string) => (Array.isArray(query[key]) ? query[key][0] : query[key]);
  const today = todayIn(context.partnerTimezone);
  return (
    <PartnerDealFlow
      role={context.role}
      initialFrom={resolveDay(one("from"), context.partnerTimezone)}
      initialTo={resolveDay(one("to"), context.partnerTimezone)}
      today={today}
    />
  );
}
