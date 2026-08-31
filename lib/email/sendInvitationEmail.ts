import "server-only";

/**
 * The three account-lifecycle emails.
 *
 * These were `console.info` stubs until SA-4.11 chose a provider. They now go through the shared
 * transport, which means the wording lives in templates.ts, the attempt is written to email_log
 * either way, and an unconfigured mail server produces a `skipped` row rather than silence.
 *
 * The return shape is unchanged, deliberately. Callers already branch on `delivered` to decide
 * whether to show the admin a copyable link, and that behaviour is still exactly right — a link
 * the admin can pass on by hand is the correct fallback when the mail server is down.
 */

import { sendEmail } from "./transport";
import {
  emailChangeConfirmationEmail,
  invitationEmail,
  passwordResetEmail,
} from "./templates";

export async function sendInvitationEmail(params: {
  to: string;
  name: string;
  inviteUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ delivered: boolean }> {
  const rendered = invitationEmail(params);
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.invitation",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}

/** SA-1.3's "send password reset link". */
export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ delivered: boolean }> {
  const rendered = passwordResetEmail(params);
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.password_reset",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}

/**
 * Goes to the NEW address — that is the whole point: it proves the person controls it before the
 * change takes effect.
 */
export async function sendEmailChangeConfirmation(params: {
  to: string;
  name: string;
  confirmUrl: string;
  expiresAt: Date;
  userId?: string | null;
  tenantId?: string | null;
}): Promise<{ delivered: boolean }> {
  const rendered = emailChangeConfirmationEmail(params);
  const result = await sendEmail({
    to: params.to,
    ...rendered,
    templateKey: "user.email_change_confirmation",
    userId: params.userId,
    tenantId: params.tenantId,
  });
  return { delivered: result.delivered };
}
