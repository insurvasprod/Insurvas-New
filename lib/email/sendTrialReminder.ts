import { sendEmail, type EmailDelivery } from "./transport.ts";

/**
 * SA-5.3's trial reminders, sent through the shared transport.
 *
 * The body is composed by `lib/trials/reminders.ts` from the customer's own plan, price and end
 * date, so this only carries it — there is no template here to drift from the one the tests pin.
 *
 * The dedupe key is the same tuple `trial_reminders` is unique on, which means the delivery log
 * and the reminder table agree about what "sent once" means.
 */
export async function sendTrialReminder(input: {
  to: string;
  subject: string;
  text: string;
  tenantId?: string | null;
  dedupeKey: string;
}): Promise<EmailDelivery> {
  return sendEmail({
    to: input.to,
    subject: input.subject,
    text: input.text,
    // The reminder bodies are plain prose with paragraph breaks; wrapping them in the shared HTML
    // shell would mean maintaining the wording twice.
    html: `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1b1c;line-height:1.6;max-width:560px">${
      input.text.split("\n\n").map((p) => `<p>${p.replaceAll("\n", "<br>")}</p>`).join("")
    }</div>`,
    templateKey: "subscription.trial_ending",
    tenantId: input.tenantId,
    dedupeKey: input.dedupeKey,
  });
}
