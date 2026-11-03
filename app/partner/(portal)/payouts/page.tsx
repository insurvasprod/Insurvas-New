import { redirect } from "next/navigation";

import { PartnerPayouts } from "@/components/partner/partner-payouts";
import { PageHeader } from "@/components/ui/page-header";
import { resolvePartnerContext } from "@/lib/partnerAuth/requirePartner";

/**
 * Partner portal › Statements (LA-7.4, Notion sprint). The payout statements the agency has
 * published for this partner. Partner admins only.
 */
export default async function PartnerPayoutsPage() {
  const context = await resolvePartnerContext();
  if (!context) redirect("/partner/login");
  if (context.role !== "partner_admin") redirect("/partner");
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6 md:h-[calc(100dvh-var(--top-bar-h)-3rem)] lg:h-[calc(100dvh-var(--top-bar-h)-3.5rem)]">
      <PageHeader title="Commission statements" description="What the agency owes you, line by line." hideTitle breadcrumbs={[{ label: "Organization" }, { label: "Commission statements" }]} />
      <PartnerPayouts partnerName={context.partnerName} />
    </div>
  );
}
