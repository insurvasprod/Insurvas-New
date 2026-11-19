// Admin › Billing › Credits & limits (billing-r2 screen 10): "Email the owner" from a usage row's sheet, telling a
// customer's owner that one of their limits is near or reached and what happens next. Kept beside the module rather
// than in lib/email/templates.ts's pinned key list (the invoice email does the same); the key is recorded in
// email_log like every other send.
//
// Pure, so the wording is testable and the sheet shows the exact preview that will be sent.

import { emailButton, emailFacts, emailNote, emailParagraph, emailShell, escapeHtml } from "../email/layout.ts";

export const LIMIT_EMAIL_TEMPLATE_KEY = "usage.limit_near";

export type LimitEmailFacts = {
  /** The owner's first name; "there" when we hold none. */
  name: string;
  customerName: string;
  /** "Dialer minutes", "Seats". */
  meter: string;
  /** Already formatted: "4,410". */
  used: string;
  limit: string;
  /** "88%". */
  share: string;
  /** "in ~4 days at this month's pace", "already over", or null when there is no forecast. */
  forecast: string | null;
  /** Hard-capped meters stop at the limit; others keep working and bill the overage. */
  hardCap: boolean;
  /** The owner's Plan & billing page. */
  billingUrl: string;
};

export function limitEmail(facts: LimitEmailFacts): { subject: string; html: string; text: string } {
  const over = facts.forecast === "already over";
  const subject = over ? `You are over your ${facts.meter.toLowerCase()} limit` : `You are close to your ${facts.meter.toLowerCase()} limit`;
  const consequence = facts.hardCap
    ? "When it is reached, this stops until the period resets or more is added."
    : "Going past it keeps working, and the extra is billed on your next invoice.";
  const html = emailShell(
    over ? `Over your ${escapeHtml(facts.meter.toLowerCase())} limit` : `Close to your ${escapeHtml(facts.meter.toLowerCase())} limit`,
    emailParagraph(`Hi ${escapeHtml(facts.name)}, ${escapeHtml(facts.customerName)} has used ${escapeHtml(facts.used)} of ${escapeHtml(facts.limit)} ${escapeHtml(facts.meter.toLowerCase())} this period.`) +
      emailFacts([
        ["Used", `${facts.used} of ${facts.limit} (${facts.share})`],
        ["Reaches the limit", facts.forecast ?? ""],
      ]) +
      emailParagraph(escapeHtml(consequence)) +
      emailButton(facts.billingUrl, "See your plan and add more") +
      emailNote("Reply to this email and we can add credits or move you to a plan that fits."),
    { eyebrow: "Usage", preheader: `${facts.used} of ${facts.limit} ${facts.meter.toLowerCase()} used`, footerNote: "You are receiving this because you own an Insurvas workspace." },
  );
  const text =
    `Hi ${facts.name},\n\n${facts.customerName} has used ${facts.used} of ${facts.limit} ${facts.meter.toLowerCase()} this period (${facts.share}).\n` +
    (facts.forecast ? (over ? "It is already past the limit.\n" : `At this month's pace it reaches the limit ${facts.forecast}.\n`) : "") +
    `\n${consequence}\n\nSee your plan and add more: ${facts.billingUrl}\n\nReply to this email and we can add credits or move you to a plan that fits.\n`;
  return { subject, html, text };
}
