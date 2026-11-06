import { NextResponse, type NextRequest } from "next/server";

import { CONTACT_PER_EMAIL, CONTACT_PER_IP, callerIp, claimAll, retryAfterSeconds } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email/transport";
import { contactRequestEmail } from "@/lib/email/templates";
import { contactFieldErrors, contactInbox, contactRequestSchema, isBot } from "@/lib/marketing/contact";

/**
 * The landing page's contact form (A8.6). Open to the internet and each call sends an email from our
 * domain, so it is checked in this order: shape, honeypot, rate limits, then one email to our own
 * inbox with Reply-To set to the visitor. Nothing is stored except `email_log`'s delivery row, which
 * `sendEmail` writes.
 *
 * A bot that fills the honeypot is told it worked, so it has nothing to learn from.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = contactRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the highlighted fields", fields: contactFieldErrors(parsed.error) }, { status: 400 });
  }
  const input = parsed.data;
  if (isBot(input)) return NextResponse.json({ ok: true });

  const limited = await claimAll([
    { rule: CONTACT_PER_IP, subject: callerIp(request.headers) },
    { rule: CONTACT_PER_EMAIL, subject: input.email },
  ]);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "You have sent a few requests already. Please try again in an hour." },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds(limited.rule)) } },
    );
  }

  const inbox = contactInbox();
  if (!inbox) {
    console.error("[contact] no inbox: set CONTACT_INBOX_EMAIL (or SMTP_FROM_EMAIL)");
    return NextResponse.json({ error: "We could not send that just now. Please try again shortly." }, { status: 503 });
  }

  const email = contactRequestEmail(input);
  const delivery = await sendEmail({ to: inbox, replyTo: input.email, templateKey: "marketing.contact_request", ...email });
  // Delivery is switched off on purpose outside production (EMAIL_DELIVERY_MODE): the request is
  // logged and the form says it was received. Any other failure (no SMTP settings, the provider
  // refused it) means nobody would read it, so the visitor is told to try again.
  if (!delivery.delivered && delivery.reason !== "email_delivery_disabled") {
    return NextResponse.json({ error: "We could not send that just now. Please try again shortly." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
