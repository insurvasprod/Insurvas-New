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
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Statements" description="What the agency owes you, line by line." />
      <PartnerPayouts />
    </div>
  );
}
