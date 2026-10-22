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

import { EMAIL_BRAND } from "./brand.ts";
import { emailButton, emailFacts, emailNote, emailParagraph, emailShell, escapeHtml, type EmailShellOptions } from "./layout.ts";

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
  // A checkout that takes no payment (CHECKOUT_PAYMENT_MODE=none): the workspace is open, here is the way in.
  "subscription.workspace_ready",
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
export { escapeHtml };

/** One shell for every email (layout.ts, drawn after the landing page), so they all look like Insurvas. */
function layout(headline: string, bodyHtml: string, options?: EmailShellOptions): string {
  return emailShell(headline, bodyHtml, options);
}

const button = emailButton;
const factList = emailFacts;
const note = emailNote;

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
        paragraph("Your existing Insurvas account has been invited to a partner workspace. Sign in with your current password to accept access.") +
          button(facts.inviteUrl, "Accept partner access") +
          note(`${expiry} If you were not expecting this, you can ignore it.`),
        { eyebrow: "Partner portal invitation", accent: "partner workspace", preheader: "Accept partner access with the Insurvas login you already have." },
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
      paragraph("An administrator has created an account for you. Set a password to get started.") +
        button(facts.inviteUrl, "Set your password") +
        note(`${expiry} If you were not expecting this, you can ignore it.`),
      { eyebrow: "Your Insurvas account", accent: "Insurvas", preheader: "Set a password to open your Insurvas account." },
    ),
    text:
      `Welcome to Insurvas, ${facts.name}.\n\n` +
      `An administrator has created an account for you. Set a password here:\n${facts.inviteUrl}\n\n` +
      `${expiry} If you were not expecting this, you can ignore it.\n`,
  };
}

/** What a role does, in one line, so an invitee knows what they are being asked to join as. */
const MEMBER_ROLE_PURPOSE: Record<string, string> = {
  owner: "run the workspace: the team, the leads, billing and settings",
  admin: "help run the agency: the team, the leads and the settings",
  manager: "lead a team of producers and keep their pipelines moving",
  producer: "work your leads, quote, and write business",
  assistant: "support the producers with their clients and paperwork",
  bookkeeper: "keep commissions, payouts and the books up to date",
  setter: "work the dialer and book appointments for the producers",
  retention: "keep clients on the books: renewals, lapses and win-backs",
};

function paragraph(html: string): string {
  return emailParagraph(html);
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/**
 * A partner (a lead vendor, referral source or affiliate) being given the partner portal for one
 * agency. Two cases: a new person sets a password; a person who already has an Insurvas login
 * accepts with it (partner/accept-invite).
 */
export function partnerInvitationEmail(facts: {
  name: string;
  inviteUrl: string;
  expiresAt: Date;
  agencyName: string;
  partnerName: string;
  roleLabel: string;
  existingAccount?: boolean;
}): RenderedEmail {
  const expiry = expiryLine(facts.expiresAt);
  const agency = facts.agencyName;
  const partner = facts.partnerName;
  const role = facts.roleLabel.toLowerCase();
  const what = `In the partner portal you can submit leads to ${agency}, follow each one through the pipeline, see your payouts, and message the agency.`;
  const adminLine = role === "partner admin" ? ` As a partner admin you can also add the rest of the ${partner} team.` : "";
  const step = facts.existingAccount
    ? "You already have an Insurvas login, so there is no new password: accept the invitation and sign in with the password you use today."
    : "Choose a password to open your account.";
  const cta = facts.existingAccount ? "Accept and sign in" : "Set your password";
  return {
    subject: `${agency} invited you to its partner portal`,
    html: layout(
      `Join ${escapeHtml(agency)}'s partner portal`,
      paragraph(`Hi ${escapeHtml(facts.name)}, ${escapeHtml(agency)} has added you to its Insurvas partner portal as ${article(role)} <strong style="color:${EMAIL_BRAND.ink}">${escapeHtml(role)}</strong> for <strong style="color:${EMAIL_BRAND.ink}">${escapeHtml(partner)}</strong>.`) +
        paragraph(escapeHtml(what + adminLine)) +
        factList([["Agency", agency], ["Your company", partner], ["Your role", facts.roleLabel], ["Sign in", facts.existingAccount ? "Your current Insurvas password" : "A password you choose"]]) +
        button(facts.inviteUrl, cta) +
        note(`${escapeHtml(step)} ${expiry} If you were not expecting this, you can ignore it and nothing will be set up.`),
      { eyebrow: "Partner portal invitation", accent: "partner portal", preheader: `${agency} added you to its partner portal. Submit leads and track every one.`, footerNote: `You are receiving this because ${agency} invited this address to its Insurvas partner portal.` },
    ),
    text:
      `Hi ${facts.name},\n\n` +
      `${agency} has added you to its Insurvas partner portal as ${article(role)} ${role} for ${partner}.\n\n` +
      `${what}${adminLine}\n\n${step}\n${facts.inviteUrl}\n\n` +
      `${expiry} If you were not expecting this, you can ignore it and nothing will be set up.\n`,
  };
}

/**
 * Someone joining an Insurvas workspace's team: a producer, admin, manager, setter and so on in an
 * agency, or a teammate of an individual agent. A person who already has an Insurvas login joins
 * with it (set-password shows "Join <workspace>" and keeps their password).
 */
export function teamInvitationEmail(facts: {
  name: string;
  inviteUrl: string;
  expiresAt: Date;
  workspaceName: string;
  inviterName: string | null;
  role: string;
  roleLabel: string;
  audience: "agency" | "individual";
  existingAccount?: boolean;
}): RenderedEmail {
  const expiry = expiryLine(facts.expiresAt);
  const workspace = facts.workspaceName;
  const role = facts.roleLabel.toLowerCase();
  const who = facts.inviterName ? `${facts.inviterName} invited you` : `You have been invited`;
  const where = `${workspace} on Insurvas`;
  const purpose = MEMBER_ROLE_PURPOSE[facts.role];
  const roleLine = purpose ? `As ${article(role)} ${role} you will ${purpose}.` : "";
  const step = facts.existingAccount
    ? `You already have an Insurvas login, so there is no new password: open the link and join ${workspace} with the password you use today.`
    : "Choose a password to open your account.";
  const cta = facts.existingAccount ? `Join ${workspace}` : "Set your password";
  return {
    subject: `${facts.inviterName ?? workspace} invited you to join ${workspace} on Insurvas`,
    html: layout(
      `Join ${escapeHtml(workspace)} on Insurvas`,
      paragraph(`Hi ${escapeHtml(facts.name)}, ${escapeHtml(who)} to join ${escapeHtml(where)} as ${article(role)} <strong style="color:${EMAIL_BRAND.ink}">${escapeHtml(role)}</strong>.`) +
        (roleLine ? paragraph(escapeHtml(roleLine)) : "") +
        factList([[facts.audience === "agency" ? "Agency" : "Workspace", workspace], ["Your role", facts.roleLabel], ["Invited by", facts.inviterName ?? ""], ["Sign in", facts.existingAccount ? "Your current Insurvas password" : "A password you choose"]]) +
        button(facts.inviteUrl, escapeHtml(cta)) +
        note(`${escapeHtml(step)} ${expiry} If you were not expecting this, you can ignore it and nothing will be set up.`),
      { eyebrow: facts.audience === "agency" ? "Agency team invitation" : "Team invitation", accent: workspace, preheader: `${who} to join ${workspace} as ${article(role)} ${role}.`, footerNote: `You are receiving this because ${facts.inviterName ?? workspace} invited this address to ${workspace} on Insurvas.` },
    ),
    text:
      `Hi ${facts.name},\n\n${who} to join ${where} as ${article(role)} ${role}.\n` +
      (roleLine ? `${roleLine}\n` : "") +
      `\n${step}\n${facts.inviteUrl}\n\n` +
      `${expiry} If you were not expecting this, you can ignore it and nothing will be set up.\n`,
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
      paragraph(`Hi ${escapeHtml(facts.name)}, we received a request to reset your Insurvas password.`) +
        button(facts.resetUrl, "Choose a new password") +
        // Said plainly because a reset email nobody asked for is how account takeover is noticed.
        note(`${expiry} If you did not ask for this, your password has not changed and you can ignore ` +
        `this email — but tell your administrator, since somebody entered your address.`),
      { eyebrow: "Account security", accent: "password", preheader: "Choose a new Insurvas password." },
    ),
    text:
      `Hi ${facts.name},\n\nWe received a request to reset your Insurvas password:\n${facts.resetUrl}\n\n` +
      `${expiry} If you did not ask for this, your password has not changed — but tell your ` +
      `administrator, since somebody entered your address.\n`,
  };
}

/**
 * The signup verification email. An individual agent and an agency owner are told what happens
 * next for THEM: one sets up their own book, the other an agency they will invite producers into.
 * No audience (a plan without a plan_type) falls back to the neutral wording.
 */
export function emailVerificationEmail(facts: {
  name: string;
  verificationUrl: string;
  audience?: "agency" | "individual" | null;
  planName?: string | null;
}): RenderedEmail {
  const plan = facts.planName ? ` on the ${facts.planName} plan` : "";
  const next =
    facts.audience === "agency"
      ? {
          subject: "Verify your email to set up your agency on Insurvas",
          intro: `Thanks for creating your agency workspace${plan}. Verify your email to continue.`,
          after: "Next you will add your agency's business details and start your trial. Then you can invite your producers, managers and staff.",
        }
      : facts.audience === "individual"
        ? {
            subject: "Verify your email to start your Insurvas account",
            intro: `Thanks for signing up as an agent${plan}. Verify your email to continue.`,
            after: "Next you will add your business details and start your trial. Then you can bring in your leads and start working them.",
          }
        : {
            subject: "Verify your Insurvas email",
            intro: "Verify your work email to continue setting up your workspace.",
            after: "",
          };
  const closing = "This link expires in 24 hours. If you did not create this account, you can ignore this message.";
  return {
    subject: next.subject,
    html: layout(
      `Welcome to Insurvas, ${escapeHtml(facts.name)}`,
      paragraph(escapeHtml(next.intro)) +
        factList([
          ["Account", facts.audience === "agency" ? "Agency" : facts.audience === "individual" ? "Individual agent" : ""],
          ["Plan", facts.planName ?? ""],
          ["Link expires", "In 24 hours"],
        ]) +
        button(facts.verificationUrl, "Verify email") +
        (next.after ? note(escapeHtml(next.after)) : "") +
        note(escapeHtml("If you did not create this account, you can ignore this message.")),
      {
        eyebrow: facts.audience === "agency" ? "Agency signup" : facts.audience === "individual" ? "Agent signup" : "Email verification",
        accent: "Insurvas",
        preheader: "One click to verify your email and keep setting up Insurvas.",
        footerNote: "You are receiving this because this address was used to sign up for Insurvas.",
      },
    ),
    text:
      `Welcome to Insurvas, ${facts.name}.\n\n${next.intro}\n${facts.verificationUrl}\n\n` +
      (next.after ? `${next.after}\n\n` : "") +
      `${closing}\n`,
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

/**
 * Sent when a checkout that takes no payment (CHECKOUT_PAYMENT_MODE=none) starts the plan: the
 * workspace is open, with a link to sign in and the setup checklist waiting on the dashboard.
 */
export function workspaceReadyEmail(facts: { name: string; planName: string; signInUrl: string }): RenderedEmail {
  return {
    subject: "Your Insurvas workspace is ready",
    html: layout(
      "Your workspace is ready",
      paragraph(`Hi ${escapeHtml(facts.name)}, your ${escapeHtml(facts.planName)} plan is active and nothing was charged.`) +
        button(facts.signInUrl, "Sign in to Insurvas") +
        note("Your dashboard opens with a short setup checklist: your carriers, your licences, your lead sources and your phone number. Work through it and you are ready to sell."),
      { eyebrow: "Welcome", accent: "ready", preheader: "Your Insurvas workspace is open." },
    ),
    text:
      `Hi ${facts.name},\n\nYour ${facts.planName} plan is active and nothing was charged. Sign in:\n${facts.signInUrl}\n\n` +
      "Your dashboard opens with a short setup checklist: your carriers, your licences, your lead sources and your phone number.\n",
  };
}
