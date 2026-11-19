// Admin › Billing › Failed payments: "Send the customer a link to update their card" (billing-r2 screen 4). Whop
// cannot be asked to retry a charge through our integration (lib/payments/types.ts: hosted checkout, no
// createCharge), so the board's fallback is what staff can do: send the owner the provider's own page for the card
// on their membership. Pure and import-free, so the dialog's preview and the email are the same words.

export type CardLinkFacts = {
  ownerName: string | null;
  businessName: string;
  /** "$99.00", or null when the amount is not known. */
  amountLabel: string | null;
  /** When the workspace goes read-only, ISO, or null. */
  readOnlyAt: string | null;
  /** The provider's card page; the preview passes a placeholder. */
  url: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

export function cardLinkEmail(facts: CardLinkFacts): { subject: string; headline: string; paragraphs: string[]; buttonLabel: string; text: string } {
  const name = facts.ownerName?.trim() || "there";
  const until = facts.readOnlyAt ? day(facts.readOnlyAt) : null;
  const paragraphs = [
    `The last payment for ${facts.businessName}${facts.amountLabel ? ` (${facts.amountLabel})` : ""} didn't go through, so your subscription is past due.`,
    `Update the card on file and the payment is tried again.${until ? ` If it is still unpaid on ${until}, the workspace becomes read-only until it is: nothing is deleted.` : " Nothing in your workspace is deleted."}`,
    "The link opens the payment provider's own page; card details never pass through Insurvas. If anything is unclear, reply to this email.",
  ];
  const buttonLabel = "Update my card";
  return {
    subject: `Action needed: update the card for ${facts.businessName}`,
    headline: "Your payment didn't go through",
    paragraphs,
    buttonLabel,
    text: `Hi ${name},\n\n${paragraphs[0]}\n\n${paragraphs[1]}\n\n${buttonLabel}: ${facts.url}\n\n${paragraphs[2]}\n`,
  };
}
