import "server-only";

import { sendEmail, type EmailDelivery } from "./transport.ts";
import { emailVerificationEmail } from "./templates.ts";

type VerificationEmailInput = {
  email: string;
  name: string;
  verificationUrl: string;
  verificationId: string;
};

export type { EmailDelivery };

/**
 * The signup verification email.
 *
 * Was a hand-written call to Resend's HTTP API. It now goes through the shared SMTP transport like
 * every other email, so there is one provider, one delivery log, and one place to change when the
 * provider changes.
 *
 * `verificationId` becomes the dedupe key. The log's unique index covers successful sends only, so
 * a resend after a genuine failure still goes out, while a double-submitted signup does not send
 * the same link twice.
 */
export async function sendVerificationEmail(input: VerificationEmailInput): Promise<EmailDelivery> {
  const rendered = emailVerificationEmail({
    name: input.name,
    verificationUrl: input.verificationUrl,
  });

  return sendEmail({
    to: input.email,
    ...rendered,
    templateKey: "user.email_verification",
    dedupeKey: `signup-verification-${input.verificationId}`,
  });
}
