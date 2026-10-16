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

import { EMAIL_BRAND, EMAIL_WRAPPER_STYLE } from "./brand.ts";

export const EMAIL_TEMPLATE_KEYS = [
  "user.invitation",
  "user.password_reset",
  "user.email_verification",
  "user.email_change_confirmation",
  // LA-8.2: password changed, email change asked for or made, two-factor turned off.
  "user.security_notice",
  // LA-8.4: an in-app notification by email, and the daily or weekly digest of them.
  "notification.alert",
  "notification.digest",
  "subscription.trial_ending",
  "agent.expiry_warning",
  "callback.reminder",
  "appointment.reminder",
  "lead.sla_escalation",
  "compliance.complaint_deadline",
  "compliance.retention_dry_run",
  "compliance.monthly_digest",
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


/** One shell for every email, so they look like they come from the same company. */
function layout(headline: string, bodyHtml: string): string {
  return [
    `<div style="${EMAIL_WRAPPER_STYLE}">`,
    // The brand bar: a thin bright-green rule over a deep-olive headline (docs/design/BRAND.md).
    `<div style="height:4px;width:48px;border-radius:999px;background:${EMAIL_BRAND.green};margin:0 0 16px"></div>`,
    `<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${EMAIL_BRAND.ink}">${headline}</h2>`,
    bodyHtml,
    `<p style="margin-top:28px;padding-top:16px;border-top:1px solid ${EMAIL_BRAND.rule};font-size:12px;color:${EMAIL_BRAND.muted}">`,
    `Insurvas &middot; you are receiving this because someone used this address to create or manage an Insurvas account.`,
    `</p>`,
    `</div>`,
  ].join("");
}

function button(url: string, label: string): string {
  return (
    `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:${EMAIL_BRAND.green};color:${EMAIL_BRAND.ink};` +
    `text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">${label}</a></p>` +
    // Buttons get stripped or fail to render often enough that the raw URL has to be present too.
    `<p style="font-size:12px;color:${EMAIL_BRAND.muted}">If the button does not work, paste this into your browser:<br>` +
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
  existingAccount?: boolean;
}): RenderedEmail {
  const expiry = expiryLine(facts.expiresAt);
  if (facts.existingAccount) {
    return {
      subject: "You have been invited to a partner workspace in Insurvas",
      html: layout(
        `Partner workspace access for ${escapeHtml(facts.name)}`,
        `<p>Your existing Insurvas account has been invited to a partner workspace. Sign in with your current password to accept access.</p>` +
          button(facts.inviteUrl, "Accept partner access") +
          `<p>${expiry} If you were not expecting this, you can ignore it.</p>`,
      ),
      text:
        `Hello ${facts.name}.\n\n` +
        `Your existing Insurvas account has been invited to a partner workspace. Accept access here and sign in with your current password:\n${facts.inviteUrl}\n\n` +
        `${expiry} If you were not expecting this, you can ignore it.\n`,
    };
  }
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

/**
 * LA-8.2 · something changed about how this account signs in. Sent whoever made the change: if it was
 * the person, they learn nothing new; if it was not, they learn immediately, which is the point.
 */
export function securityNoticeEmail(facts: { name: string; what: string; when: Date; detail?: string; profileUrl: string }): RenderedEmail {
  const when = facts.when.toUTCString();
  const notYou = "If this was not you, change your password now and end your other sessions from My profile, or contact your agency's owner.";
  return {
    subject: `Insurvas security notice: ${facts.what.toLowerCase()}`,
    html: layout(
      escapeHtml(facts.what),
      `<p>Hi ${escapeHtml(facts.name)}, this happened on your Insurvas account on ${escapeHtml(when)}.</p>` +
        (facts.detail ? `<p>${escapeHtml(facts.detail)}</p>` : "") +
        `<p>${notYou}</p>` +
        button(facts.profileUrl, "Open My profile"),
    ),
    text: `Hi ${facts.name},

${facts.what} on your Insurvas account on ${when}.
${facts.detail ? `${facts.detail}
` : ""}
${notYou}
${facts.profileUrl}
`,
  };
}

/** LA-8.4 · one notification, by email, as the person chose. */
export function notificationAlertEmail(facts: { name: string; title: string; body: string; url: string | null; settingsUrl: string; protectedReason?: string }): RenderedEmail {
  const footer = facts.protectedReason
    ? `This alert cannot be switched off. ${facts.protectedReason}`
    : "Choose which alerts reach you, and how, in Settings › Notifications.";
  return {
    subject: facts.title,
    html: layout(
      escapeHtml(facts.title),
      `<p>Hi ${escapeHtml(facts.name)},</p>` + (facts.body ? `<p>${escapeHtml(facts.body)}</p>` : "") +
        (facts.url ? button(facts.url, "Open it in Insurvas") : "") +
        `<p style="font-size:12px;color:${EMAIL_BRAND.muted}">${escapeHtml(footer)} <a href="${escapeHtml(facts.settingsUrl)}">Notification settings</a></p>`,
    ),
    text: [`Hi ${facts.name},`, "", facts.title, facts.body, facts.url ?? "", "", footer, facts.settingsUrl].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n") + "\n",
  };
}

/** LA-8.4 · the daily or weekly digest. Never sent empty: the caller only calls with items. */
export function notificationDigestEmail(facts: { name: string; cadence: "daily" | "weekly"; items: { title: string; body: string; url: string | null }[]; settingsUrl: string }): RenderedEmail {
  const what = facts.cadence === "daily" ? "today" : "this week";
  const count = `${facts.items.length} update${facts.items.length === 1 ? "" : "s"}`;
  return {
    subject: `Insurvas: ${count} ${what}`,
    html: layout(
      `${count} ${what}`,
      `<p>Hi ${escapeHtml(facts.name)}, here is what happened ${what}.</p>` +
        `<ul style="padding-left:18px">${facts.items.map((i) => `<li style="margin:0 0 10px"><strong>${i.url ? `<a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a>` : escapeHtml(i.title)}</strong>${i.body ? `<br><span style="color:${EMAIL_BRAND.muted}">${escapeHtml(i.body)}</span>` : ""}</li>`).join("")}</ul>` +
        `<p style="font-size:12px;color:${EMAIL_BRAND.muted}">You chose a ${facts.cadence} digest for these. <a href="${escapeHtml(facts.settingsUrl)}">Notification settings</a></p>`,
    ),
    text: [
      `Hi ${facts.name},`, "", `${count} ${what}:`, "",
      ...facts.items.map((i) => [`- ${i.title}`, i.body ? `  ${i.body}` : null, i.url ? `  ${i.url}` : null].filter(Boolean).join("\n")),
      "", `Notification settings: ${facts.settingsUrl}`,
    ].join("\n") + "\n",
  };
}

export function appointmentExpiryWarningEmail(facts: {
  name: string;
  label: string;
  days: number;
  expiresAt: string;
  settingsUrl: string;
}): RenderedEmail {
  return {
    subject: `${facts.label} expires in ${facts.days} days`,
    html: layout(
      `${escapeHtml(facts.label)} needs attention`,
      `<p>Hi ${escapeHtml(facts.name)},</p><p>Your ${escapeHtml(facts.label)} expires in ${facts.days} days, on ${escapeHtml(facts.expiresAt)}. Renew it before that date so you can keep writing business where you are appointed.</p>${button(facts.settingsUrl, "Review your appointment vault")}`,
    ),
    text: `Hi ${facts.name},\n\nYour ${facts.label} expires in ${facts.days} days, on ${facts.expiresAt}. Renew it before that date so you can keep writing business where you are appointed.\n\nReview your appointment vault: ${facts.settingsUrl}\n`,
  };
}

export function callbackReminderEmail(facts: { name: string; customerName: string; customerTime: string; customerTimezone: string; note: string | null; callbacksUrl: string }): RenderedEmail {
  return {
    subject: `Callback reminder: ${facts.customerName}`,
    html: layout("Callback reminder", `<p>Hi ${escapeHtml(facts.name)},</p><p>You have a callback with <strong>${escapeHtml(facts.customerName)}</strong> at <strong>${escapeHtml(facts.customerTime)}</strong> (${escapeHtml(facts.customerTimezone)}).</p>${facts.note ? `<p>Note: ${escapeHtml(facts.note)}</p>` : ""}${button(facts.callbacksUrl, "Open callback calendar")}`),
    text: `Hi ${facts.name},\n\nYou have a callback with ${facts.customerName} at ${facts.customerTime} (${facts.customerTimezone}).${facts.note ? `\nNote: ${facts.note}` : ""}\n\nOpen callback calendar: ${facts.callbacksUrl}\n`,
  };
}

export function appointmentReminderEmail(facts: { name: string; customerName: string; customerTime: string; customerTimezone: string; agentTime: string; agentTimezone: string; note: string | null; leadUrl: string }): RenderedEmail {
  return {
    subject: `Appointment reminder: ${facts.customerName}`,
    html: layout("Appointment reminder", `<p>Hi ${escapeHtml(facts.name)},</p><p>You have an appointment with <strong>${escapeHtml(facts.customerName)}</strong> at <strong>${escapeHtml(facts.agentTime)}</strong> (${escapeHtml(facts.agentTimezone)}).</p><p>The customer's recorded local time is <strong>${escapeHtml(facts.customerTime)}</strong> (${escapeHtml(facts.customerTimezone)}).</p>${facts.note ? `<p>Notes: ${escapeHtml(facts.note)}</p>` : ""}${button(facts.leadUrl, "Open lead")}`),
    text: `Hi ${facts.name},\n\nYou have an appointment with ${facts.customerName} at ${facts.agentTime} (${facts.agentTimezone}).\nThe customer's recorded local time is ${facts.customerTime} (${facts.customerTimezone}).${facts.note ? `\nNotes: ${facts.note}` : ""}\n\nOpen lead: ${facts.leadUrl}\n`,
  };
}

export function slaEscalationEmail(facts: { name: string; customerName: string; partnerName: string; leadUrl: string }): RenderedEmail {
  return {
    subject: `Unclaimed lead needs attention: ${facts.customerName}`,
    html: layout("Unclaimed lead needs attention", `<p>Hi ${escapeHtml(facts.name)},</p><p><strong>${escapeHtml(facts.customerName)}</strong> from ${escapeHtml(facts.partnerName)} has passed the response threshold and is still unclaimed.</p>${button(facts.leadUrl, "Open lead")}`),
    text: `Hi ${facts.name},\n\n${facts.customerName} from ${facts.partnerName} has passed the response threshold and is still unclaimed.\n\nOpen lead: ${facts.leadUrl}\n`,
  };
}

/** LA-6.4 · a regulator complaint inside its red window, or past its deadline. */
export function complaintDeadlineEmail(facts: { name: string; overdue: boolean; countdownLabel: string; regulator: string; category: string; receivedOn: string; dueOn: string; complaintUrl: string }): RenderedEmail {
  const subject = facts.overdue ? `Overdue: a ${facts.regulator} complaint has passed its response deadline` : `${facts.countdownLabel}: ${facts.regulator} complaint`;
  const body = `A ${facts.category.toLowerCase()} complaint received ${facts.receivedOn} must be answered by ${facts.dueOn}. A missed regulator deadline puts the licence at risk.`;
  return {
    subject,
    html: layout(facts.overdue ? "A complaint is overdue" : "A complaint deadline is close", `<p>Hi ${escapeHtml(facts.name)},</p><p>${escapeHtml(body)}</p>${button(facts.complaintUrl, "Open the complaint")}`),
    text: `Hi ${facts.name},\n\n${body}\n\nOpen the complaint: ${facts.complaintUrl}\n`,
  };
}

/** LA-6.6 · a scheduled retention dry run: what the live run will delete, before it does. */
export function retentionDryRunEmail(facts: { name: string; lines: string[]; held: number; liveOn: string; settingsUrl: string }): RenderedEmail {
  const list = facts.lines.length ? facts.lines : ["Nothing is due for deletion."];
  return {
    subject: "Retention: what the next purge will delete",
    html: layout("Retention dry run", `<p>Hi ${escapeHtml(facts.name)},</p><p>The scheduled dry run found:</p><ul>${list.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p>${facts.held} record(s) are under a legal hold and will not be touched. The live run follows on ${escapeHtml(facts.liveOn)} unless you switch the schedule off.</p>${button(facts.settingsUrl, "Review retention")}`),
    text: `Hi ${facts.name},\n\nThe scheduled dry run found:\n${list.map((l) => `- ${l}`).join("\n")}\n\n${facts.held} record(s) are under a legal hold and will not be touched. The live run follows on ${facts.liveOn} unless you switch the schedule off.\n\nReview retention: ${facts.settingsUrl}\n`,
  };
}

/** LA-6.7 · the monthly compliance nudge: standing coverage and the book-wide gap scan. */
export function complianceMonthlyEmail(facts: { name: string; month: string; coverage: string[]; gaps: string[]; dashboardUrl: string }): RenderedEmail {
  const gaps = facts.gaps.length ? facts.gaps : ["No gaps found by the checks that could run."];
  return {
    subject: `Compliance for ${facts.month}: ${facts.gaps.length ? `${facts.gaps.length} thing${facts.gaps.length === 1 ? "" : "s"} to fix` : "no gaps found"}`,
    html: layout(`Compliance, ${escapeHtml(facts.month)}`, `<p>Hi ${escapeHtml(facts.name)},</p><p><strong>Gaps across your book</strong></p><ul>${gaps.map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ul><p><strong>Coverage</strong></p><ul>${facts.coverage.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul><p>A gap fixed now is free; the same gap found after a demand letter is not.</p>${button(facts.dashboardUrl, "Open the compliance dashboard")}`),
    text: `Hi ${facts.name},\n\nGaps across your book:\n${gaps.map((g) => `- ${g}`).join("\n")}\n\nCoverage:\n${facts.coverage.map((c) => `- ${c}`).join("\n")}\n\nA gap fixed now is free; the same gap found after a demand letter is not.\n\nOpen the compliance dashboard: ${facts.dashboardUrl}\n`,
  };
}