import { redirect } from "next/navigation";

import { PartnerPayouts } from "@/components/partner/partner-payouts";
import { PARTNER_WORDS } from "@/lib/partnerAuth/portalAccess";

import { partnerPageContext } from "../page-gate";

/**
 * Partner portal › Statements (LA-7.4, Notion sprint). The payout statements the agency has
 * published for this partner, in the partner type's words: accepted transfers × rate for a publisher,
 * leads, sales or a revenue-share rate for marketing, sales for an affiliate. Partner admins only.
 */
export default async function PartnerPayoutsPage() {
  const context = await partnerPageContext("statements");
  // Said again in so many words (portalAccess.ts already refuses a partner user): statements are the admin's.
  if (context.role !== "partner_admin") redirect("/partner");
  const words = PARTNER_WORDS[context.partnerType];
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6 md:h-[calc(100dvh-var(--top-bar-h)-3rem)] lg:h-[calc(100dvh-var(--top-bar-h)-3.5rem)]">
      {/* The header is drawn by PartnerPayouts, so Invoices · Coming up sit on its line (UI-CONSISTENCY §8b). */}
      <PartnerPayouts
        partnerName={context.partnerName}
        noun={{ one: words.one, many: words.many }}
        header={{ title: "Statements", description: `What the agency owes you, line by line. ${words.statementBasis}`, breadcrumbs: [{ label: "Organization" }, { label: "Statements" }] }}
      />
    </div>
  );
}
