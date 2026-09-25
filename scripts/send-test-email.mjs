// SA-4.11 · Proves the mail configuration end to end.
//
// Two steps, deliberately separate: verify() opens an authenticated SMTP connection WITHOUT
// sending, which is what tells you a credential is wrong rather than a mailbox being unreachable.
// Only then does it send a real message and write the delivery log row.
//
// Run only with deliberate external-delivery opt-in: EMAIL_DELIVERY_MODE=smtp npm run email:test -- you@your-domain.com
import { verifyEmailConnection, sendEmail, emailConfigProblems, isReservedTestRecipient } from "../lib/email/transport.ts";
import { escapeHtml } from "../lib/email/templates.ts";

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("Usage: EMAIL_DELIVERY_MODE=smtp npm run email:test -- you@your-domain.com");
  process.exit(1);
}

if (isReservedTestRecipient(to)) {
  console.error("Refusing to send to a reserved test address. Use a real mailbox only for an intentional SMTP test.");
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
// This is a transport test, not a real invitation. Never put a fake token in an
// invitation email: recipients will click it and quite correctly see an invalid link.
const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/partner/login`;
const rendered = {
  subject: "Insurvas SMTP delivery test",
  html:
    `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1b1c;line-height:1.6;max-width:560px">` +
    `<h2 style="margin:0 0 16px;font-size:20px;font-weight:800;color:#00407f">Insurvas SMTP test</h2>` +
    `<p>This message confirms that Insurvas can authenticate with SMTP and deliver mail.</p>` +
    `<p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#00407f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Open partner portal</a></p>` +
    `<p style="font-size:12px;color:#64748b">If the button does not work, paste this into your browser:<br>` +
    `<span style="word-break:break-all">${escapeHtml(portalUrl)}</span></p>` +
    `<p style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">Insurvas SMTP configuration test.</p>` +
    `</div>`,
  text: `Insurvas SMTP test\n\nThis message confirms that Insurvas can authenticate with SMTP and deliver mail.\n\nOpen the partner portal: ${portalUrl}\n`,
};

const result = await sendEmail({
  to,
  ...rendered,
  subject: `[test] ${rendered.subject}`,
  templateKey: "system.smtp_test",
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
