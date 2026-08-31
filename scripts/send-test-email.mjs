// SA-4.11 · Proves the mail configuration end to end.
//
// Two steps, deliberately separate: verify() opens an authenticated SMTP connection WITHOUT
// sending, which is what tells you a credential is wrong rather than a mailbox being unreachable.
// Only then does it send a real message and write the delivery log row.
//
// Run: npm run email:test -- you@example.com
import { verifyEmailConnection, sendEmail, emailConfigProblems } from "../lib/email/transport.ts";
import { invitationEmail } from "../lib/email/templates.ts";

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("Usage: npm run email:test -- you@example.com");
  process.exit(1);
}

const missing = emailConfigProblems();
if (missing.length > 0) {
  console.error(`Not configured. Set these in .env.local:\n  ${missing.join("\n  ")}`);
  console.error("\nFor Google: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER is the full");
  console.error("address, and SMTP_PASSWORD is a 16-character App Password (2-Step Verification");
  console.error("must be on first — your normal password will be rejected).");
  process.exit(1);
}

console.log(`Host      ${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 587}`);
console.log(`User      ${process.env.SMTP_USER}`);
console.log(`From      "${process.env.SMTP_FROM_NAME ?? "Insurvas"}" <${process.env.SMTP_FROM_EMAIL}>`);
console.log(`Password  ${"•".repeat(12)} (${(process.env.SMTP_PASSWORD ?? "").length} chars)\n`);

process.stdout.write("Authenticating… ");
const connection = await verifyEmailConnection();
if (!connection.ok) {
  console.log("FAILED\n");
  console.error(connection.error);
  // The three failures worth naming, because each has a different fix and Google's own message
  // does not say which one you hit.
  console.error("\nCommon causes:");
  console.error("  535 / BadCredentials  — using the account password instead of an App Password,");
  console.error("                          or 2-Step Verification is not enabled on the account.");
  console.error("  ETIMEDOUT / ECONNREFUSED — outbound port 587 is blocked by your network.");
  console.error("  534 / Please log in via your web browser — the account needs an App Password.");
  process.exit(1);
}
console.log("ok");

process.stdout.write(`Sending to ${to}… `);
const rendered = invitationEmail({
  name: "Test Recipient",
  inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/app/set-password?token=sample`,
  expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
});

const result = await sendEmail({
  to,
  ...rendered,
  subject: `[test] ${rendered.subject}`,
  templateKey: "user.invitation",
});

if (!result.delivered) {
  console.log("FAILED");
  console.error(`\nReason: ${result.reason} — see the email_log table for the provider's message.`);
  process.exit(1);
}

console.log("sent");
console.log(`\nMessage id: ${result.providerId}`);
console.log("Recorded in email_log. If it does not arrive, check spam — a brand-new sending");
console.log("address with no reputation is often filtered on its first few messages.");
