// SA-4.11 · What each email says.
//
// Pure functions, so wording is unit-testable without a mail server. They live here rather than
// inline at each call site because the next step of SA-4.11 moves them into `email_templates` in
// the database — and a template that is already a function of named facts is a template that can
// be turned into a row without rewriting its callers.
//
// Every template returns text AND html. Text is not a courtesy: a mail client that renders only
// text, a screen reader, and a spam filter all read it, and an email with an empty text part
// scores worse for deliverability.

export const EMAIL_TEMPLATE_KEYS = [
  "user.invitation",
  "user.password_reset",
  "user.email_verification",
  "user.email_change_confirmation",
  "subscription.trial_ending",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export type RenderedEmail = { subject: string; html: string; text: string };

/** Escapes before interpolation. A user-supplied name reaches these bodies. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const BRAND = "#00407f";

/** One shell for every email, so they look like they come from the same company. */
function layout(headline: string, bodyHtml: string): string {
  return [
    `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1b1c;line-height:1.6;max-width:560px">`,
    `<h2 style="margin:0 0 16px;font-size:20px;font-weight:800;color:${BRAND}">${headline}</h2>`,
    bodyHtml,
    `<p style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">`,
    `Insurvas &middot; you are receiving this because someone used this address to create or manage an Insurvas account.`,
    `</p>`,
    `</div>`,
  ].join("");
}

function button(url: string, label: string): string {
  return (
    `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:${BRAND};color:#fff;` +
    `text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">${label}</a></p>` +
    // Buttons get stripped or fail to render often enough that the raw URL has to be present too.
    `<p style="font-size:12px;color:#64748b">If the button does not work, paste this into your browser:<br>` +
    `<span style="word-break:break-all">${escapeHtml(url)}</span></p>`
  );
}

function expiryLine(expiresAt: Date): string {
  const hours = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));
  return hours >= 48
    ? `This link expires in ${Math.round(hours / 24)} days.`
    : `This link expires in ${hours} hour${hours === 1 ? "" : "s"}.`;
}

export function invitationEmail(facts: {
  name: string;
  inviteUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const expiry = expiryLine(facts.expiresAt);
  return {
    subject: "You have been invited to Insurvas",
    html: layout(
      `Welcome to Insurvas, ${escapeHtml(facts.name)}`,
      `<p>An administrator has created an account for you. Set a password to get started.</p>` +
        button(facts.inviteUrl, "Set your password") +
        `<p>${expiry} If you were not expecting this, you can ignore it.</p>`,
    ),
    text:
      `Welcome to Insurvas, ${facts.name}.\n\n` +
      `An administrator has created an account for you. Set a password here:\n${facts.inviteUrl}\n\n` +
      `${expiry} If you were not expecting this, you can ignore it.\n`,
  };
}

export function passwordResetEmail(facts: {
  name: string;
  resetUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const expiry = expiryLine(facts.expiresAt);
  return {
    subject: "Reset your Insurvas password",
    html: layout(
      "Reset your password",
      `<p>Hi ${escapeHtml(facts.name)}, we received a request to reset your Insurvas password.</p>` +
        button(facts.resetUrl, "Choose a new password") +
        // Said plainly because a reset email nobody asked for is how account takeover is noticed.
        `<p>${expiry} If you did not ask for this, your password has not changed and you can ignore ` +
        `this email — but tell your administrator, since somebody entered your address.</p>`,
    ),
    text:
      `Hi ${facts.name},\n\nWe received a request to reset your Insurvas password:\n${facts.resetUrl}\n\n` +
      `${expiry} If you did not ask for this, your password has not changed — but tell your ` +
      `administrator, since somebody entered your address.\n`,
  };
}

export function emailVerificationEmail(facts: {
  name: string;
  verificationUrl: string;
}): RenderedEmail {
  return {
    subject: "Verify your Insurvas email",
    html: layout(
      `Welcome to Insurvas, ${escapeHtml(facts.name)}`,
      `<p>Verify your work email to continue setting up your workspace.</p>` +
        button(facts.verificationUrl, "Verify email") +
        `<p>This link expires in 24 hours. If you did not create this account, you can ignore this message.</p>`,
    ),
    text:
      `Welcome to Insurvas, ${facts.name}.\n\nVerify your email to continue:\n${facts.verificationUrl}\n\n` +
      `This link expires in 24 hours. If you did not create this account, you can ignore this message.\n`,
  };
}

/**
 * Goes to the NEW address, which is the entire point: it proves the person controls it before the
 * change takes effect.
 */
export function emailChangeConfirmationEmail(facts: {
  name: string;
  confirmUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const expiry = expiryLine(facts.expiresAt);
  return {
    subject: "Confirm your new Insurvas email address",
    html: layout(
      "Confirm your new address",
      `<p>Hi ${escapeHtml(facts.name)}, this address was given as the new sign-in email for an ` +
        `Insurvas account. Confirm it to make the change.</p>` +
        button(facts.confirmUrl, "Confirm this address") +
        `<p>${expiry} Until you confirm, the old address keeps working and nothing changes.</p>`,
    ),
    text:
      `Hi ${facts.name},\n\nThis address was given as the new sign-in email for an Insurvas account. ` +
      `Confirm it here:\n${facts.confirmUrl}\n\n` +
      `${expiry} Until you confirm, the old address keeps working and nothing changes.\n`,
  };
}
