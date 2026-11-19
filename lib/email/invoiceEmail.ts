// Admin › Billing › Invoices (billing-r2 screen 5): an invoice emailed to the customer's owner, from the
// invoice's sheet ("Email to customer", previewed before it goes). Kept beside templates.ts rather than in its
// pinned key list: the key is "invoice.sent", recorded in email_log like every other send, which is what the
// sheet's "Emails sent" tab reads back.
//
// Pure, so the wording is testable and the sheet can show the exact preview that will be sent.

import { emailButton, emailFacts, emailNote, emailParagraph, emailShell, escapeHtml } from "./layout.ts";

export const INVOICE_EMAIL_TEMPLATE_KEY = "invoice.sent";

export type InvoiceEmailFacts = {
  /** The owner's first name or full name; "there" when we hold none. */
  name: string;
  customerName: string;
  number: string;
  /** Already formatted: "$299.00". */
  total: string;
  issued: string;
  due: string;
  /** "Paid", "Overdue 16 days", "Due Nov 30". */
  standing: string;
  /** The owner's own copy of the invoice: Settings › Plan & billing's printable invoice. */
  viewUrl: string;
};

export function invoiceEmail(facts: InvoiceEmailFacts): { subject: string; html: string; text: string } {
  const subject = `Invoice ${facts.number} from Insurvas`;
  const html = emailShell(
    `Invoice ${escapeHtml(facts.number)}`,
    emailParagraph(`Hi ${escapeHtml(facts.name)}, here is invoice ${escapeHtml(facts.number)} for ${escapeHtml(facts.customerName)}.`) +
      emailFacts([
        ["Total", facts.total],
        ["Issued", facts.issued],
        ["Due", facts.due],
        ["Status", facts.standing],
      ]) +
      emailButton(facts.viewUrl, "View or print the invoice") +
      emailNote("Reply to this email with any question about it."),
    { eyebrow: "Billing", preheader: `Invoice ${facts.number} · ${facts.total} · ${facts.standing}`, footerNote: "You are receiving this because you own an Insurvas workspace." },
  );
  const text =
    `Hi ${facts.name},\n\nHere is invoice ${facts.number} for ${facts.customerName}.\n\n` +
    `Total: ${facts.total}\nIssued: ${facts.issued}\nDue: ${facts.due}\nStatus: ${facts.standing}\n\n` +
    `View or print it: ${facts.viewUrl}\n\nReply to this email with any question about it.\n`;
  return { subject, html, text };
}
