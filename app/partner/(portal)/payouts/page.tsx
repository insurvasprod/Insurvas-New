import { redirect } from "next/navigation";

import { PartnerPayouts } from "@/components/partner/partner-payouts";
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
      {/* The header is drawn by PartnerPayouts, so Invoices · Coming up sit on its line (UI-CONSISTENCY §8b). */}
      <PartnerPayouts partnerName={context.partnerName} header={{ title: "Commissions", description: "What the agency owes you, line by line.", breadcrumbs: [{ label: "Organization" }, { label: "Commissions" }] }} />
    </div>
  );
}
