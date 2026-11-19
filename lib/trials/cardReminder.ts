// Admin › Billing › Trials: "Email a card reminder" (billing-r2 screen 3). What the email says to a trial's owner
// who has no card on file, built from their own business, plan and end date. Pure, with no imports, so the
// preview in the admin's dialog (client) and the email sent by POST /api/admin/trials/card-reminders (server)
// are the same words, and the test pins them.

export type CardReminderFacts = {
  /** The owner's name, or null when we do not have one ("Hi there"). */
  ownerName: string | null;
  /** The trading name, else the workspace's name. */
  businessName: string;
  planName: string;
  /** The trial's end, ISO. */
  trialEndsAt: string;
  /** Whole calendar days left (UTC), never below zero. */
  daysLeft: number;
  /** Where the owner adds the card: the app's Plan & billing. */
  billingUrl: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "November 19" (UTC): the same on the server, in the browser and in the inbox. */
export function endDateWords(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the end of your trial";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function whenWords(daysLeft: number, ends: string): string {
  if (daysLeft <= 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return `in ${daysLeft} days, on ${ends}`;
}

export function cardReminderEmail(facts: CardReminderFacts): { subject: string; text: string; headline: string; paragraphs: string[]; buttonLabel: string } {
  const ends = endDateWords(facts.trialEndsAt);
  const when = whenWords(facts.daysLeft, ends);
  const name = facts.ownerName?.trim() || "there";
  const paragraphs = [
    `Your ${facts.planName} trial for ${facts.businessName} ends ${when}, and there is no card on file yet.`,
    `Add a card in Plan & billing to keep everything working after ${ends}: your leads, calls, applications and team stay exactly as they are. Nothing is charged before the trial ends.`,
    "If you need more time to decide, or something is in the way, reply to this email and we will help.",
  ];
  const buttonLabel = "Add a card";
  return {
    subject: facts.daysLeft <= 1 ? `Your Insurvas trial ends ${facts.daysLeft <= 0 ? "today" : "tomorrow"}: add a card to keep going` : `Add a card to keep ${facts.businessName} on Insurvas after ${ends}`,
    headline: `Keep ${facts.businessName} going`,
    paragraphs,
    buttonLabel,
    text: `Hi ${name},\n\n${paragraphs[0]}\n\n${paragraphs[1]}\n\n${buttonLabel}: ${facts.billingUrl}\n\n${paragraphs[2]}\n`,
  };
}
