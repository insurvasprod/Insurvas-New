// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMAIL_TEMPLATE_KEYS,
  emailChangeConfirmationEmail,
  appointmentExpiryWarningEmail,
  appointmentReminderEmail,
  emailVerificationEmail,
  escapeHtml,
  invitationEmail,
  passwordResetEmail,
} from "./templates.ts";

const IN_3_DAYS = new Date(Date.now() + 72 * 3600 * 1000);
const IN_1_HOUR = new Date(Date.now() + 3600 * 1000);

const ALL = [
  invitationEmail({ name: "Dana", inviteUrl: "https://app.test/i?t=abc", expiresAt: IN_3_DAYS }),
  passwordResetEmail({ name: "Dana", resetUrl: "https://app.test/r?t=abc", expiresAt: IN_1_HOUR }),
  emailVerificationEmail({ name: "Dana", verificationUrl: "https://app.test/v?t=abc" }),
  emailChangeConfirmationEmail({ name: "Dana", confirmUrl: "https://app.test/c?t=abc", expiresAt: IN_3_DAYS }),
];

const EXISTING_PARTNER = invitationEmail({ name: "Dana", inviteUrl: "https://app.test/partner/accept-invite?t=abc", expiresAt: IN_3_DAYS, existingAccount: true });

const EVERY_EMAIL = [
  ...ALL,
  EXISTING_PARTNER,
  appointmentExpiryWarningEmail({ name: "Dana", label: "AZ licence", days: 30, expiresAt: "2026-09-30", settingsUrl: "https://app.test/settings" }),
  appointmentReminderEmail({ name: "Dana", customerName: "Jordan", customerTime: "9:00 AM", customerTimezone: "America/Phoenix", agentTime: "11:00 AM", agentTimezone: "America/New_York", note: "Discuss term options", leadUrl: "https://app.test/app/leads/lead-1" }),
];

test("every email has a non-empty subject, html and text", () => {
  // An empty text part is not cosmetic: text-only clients, screen readers and spam filters all
  // read it, and its absence hurts deliverability.
  for (const email of EVERY_EMAIL) {
    assert.ok(email.subject.length > 5, JSON.stringify(email.subject));
    assert.ok(email.html.length > 100);
    assert.ok(email.text.length > 50);
  }
});

test("the action link appears in both parts, so a stripped button is not a dead end", () => {
  for (const email of [...ALL, EXISTING_PARTNER]) {
    const url = /https:\/\/app\.test\/(?:[a-z]\?t=abc|partner\/accept-invite\?t=abc)/;
    assert.match(email.text, url, `missing from text: ${email.subject}`);
    assert.match(email.html, url, `missing from html: ${email.subject}`);
  }
});

test("appointment reminders open the related lead, not the carrier appointment vault", () => {
  const email = EVERY_EMAIL.at(-1);
  assert.ok(email);
  assert.match(email.text, /Open lead: https:\/\/app\.test\/app\/leads\/lead-1/);
  assert.match(email.html, /https:\/\/app\.test\/app\/leads\/lead-1/);
  assert.doesNotMatch(email.text, /app\/appointments/);
});

test("an existing-account partner invite asks for the current password instead of replacing it", () => {
  assert.match(EXISTING_PARTNER.text, /current password/i);
  assert.match(EXISTING_PARTNER.html, /Accept partner access/);
  assert.doesNotMatch(EXISTING_PARTNER.text, /Set a password/i);
});

test("a name containing markup is escaped in the html but left alone in the text", () => {
  const evil = '<script>alert("x")</script>';
  const email = invitationEmail({ name: evil, inviteUrl: "https://app.test/i", expiresAt: IN_3_DAYS });
  assert.ok(!email.html.includes("<script>"), "unescaped markup reached the html body");
  assert.ok(email.html.includes("&lt;script&gt;"));
  assert.ok(email.text.includes(evil), "the text part is not html and must not be escaped");
});

test("escapeHtml covers the five characters that matter", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#039;");
});

test("expiry is described in the unit a person would use", () => {
  const soon = passwordResetEmail({ name: "D", resetUrl: "https://app.test/r", expiresAt: IN_1_HOUR });
  assert.match(soon.text, /expires in 1 hour\b/);

  const later = invitationEmail({ name: "D", inviteUrl: "https://app.test/i", expiresAt: IN_3_DAYS });
  assert.match(later.text, /expires in 3 days/);
});

test("the password reset tells someone who did not ask for it what to do", () => {
  // A reset email nobody requested is how account takeover gets noticed, so it must not read as
  // routine noise.
  const email = passwordResetEmail({ name: "D", resetUrl: "https://app.test/r", expiresAt: IN_1_HOUR });
  assert.match(email.text, /did not ask for this/i);
  assert.match(email.text, /tell your\s+administrator/i);
});

test("the email-change confirmation says the old address still works", () => {
  const email = emailChangeConfirmationEmail({
    name: "D", confirmUrl: "https://app.test/c", expiresAt: IN_3_DAYS,
  });
  assert.match(email.text, /old address keeps working/i);
});

test("the template key list matches what the senders actually use", () => {
  assert.deepEqual([...EMAIL_TEMPLATE_KEYS], [
    "user.invitation",
    "user.password_reset",
    "user.email_verification",
    "user.email_change_confirmation",
    "subscription.trial_ending",
    "agent.expiry_warning",
    "callback.reminder",
    "appointment.reminder",
    "lead.sla_escalation",
  ]);
});
