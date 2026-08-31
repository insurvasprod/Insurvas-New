// SA-4.11 · The one place an email leaves the platform.
//
// Every seam — invitations, password resets, verification, trial reminders — goes through send().
// That is the point: the provider is chosen once, the delivery log is written once, and a caller
// cannot forget to record what it did.
//
// Deliberately NOT marked `server-only`, unlike the senders that wrap it: the nightly trial
// reminder job is a plain Node script and has to reach the same transport, and a second copy of
// the sending logic for cron would be exactly the kind of drift this module exists to prevent.
// The senders above it carry the marker, and nodemailer's node: imports fail a client build
// regardless, so nothing here can reach a browser bundle.
//
// Google SMTP is the provider today. It is behind this interface rather than called directly
// because its limits are real (500/day on free Gmail, 2,000 on Workspace, and a TCP connection
// held open from a serverless function) and swapping to an HTTP provider later should be a change
// to this file alone.

import nodemailer, { type Transporter } from "nodemailer";

import { getSupabaseServiceClient } from "../supabase/service.ts";

export type EmailDelivery =
  | { delivered: true; providerId: string }
  | { delivered: false; reason: string };

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Identifies which email this is, for the delivery log. Matches SA-4.11's template keys. */
  templateKey: string;
  /** Recorded so a support question about one person does not need a text search. */
  userId?: string | null;
  tenantId?: string | null;
  /**
   * Makes a retry recognisable as a retry. The log's unique index covers successful sends only,
   * so a failed attempt can always be tried again.
   */
  dedupeKey?: string | null;
  replyTo?: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
};

/**
 * Reads SMTP configuration, or explains what is missing.
 *
 * Returns the missing variable names rather than a bare null: "email is not configured" sends
 * whoever is debugging to read this file, where "SMTP_PASSWORD is not set" does not.
 */
function readConfig(): { ok: true; config: SmtpConfig } | { ok: false; missing: string[] } {
  const required = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      host: required.SMTP_HOST!,
      // 587 is STARTTLS, which is what Google documents for smtp.gmail.com. 465 is implicit TLS
      // and also works; `secure` is derived from the port rather than configured separately so
      // the two cannot be set to contradict each other.
      port: Number(process.env.SMTP_PORT ?? 587),
      user: required.SMTP_USER!,
      password: required.SMTP_PASSWORD!,
      fromName: process.env.SMTP_FROM_NAME?.trim() || "Insurvas",
      fromEmail: required.SMTP_FROM_EMAIL!,
    },
  };
}

export function emailIsConfigured(): boolean {
  return readConfig().ok;
}

/** Missing variable names, for the admin screen and the test-send script. */
export function emailConfigProblems(): string[] {
  const result = readConfig();
  return result.ok ? [] : result.missing;
}

// One pooled transporter per process. Creating a connection per email is what makes SMTP slow in
// a serverless function; pooling lets warm invocations reuse it.
let cached: { transporter: Transporter; key: string } | null = null;

function transporterFor(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.user}`;
  if (cached?.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    pool: true,
    maxConnections: 3,
    // A hung SMTP connection must not hold a request open until the platform's own timeout.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  cached = { transporter, key };
  return transporter;
}

/** Never let a provider's error text carry a credential into the log. */
function safeReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const password = process.env.SMTP_PASSWORD;
  const redacted = password ? raw.replaceAll(password, "[redacted]") : raw;
  return redacted.slice(0, 500);
}

async function record(input: SendEmailInput, row: {
  status: "sent" | "failed" | "skipped";
  providerMessageId?: string | null;
  failureReason?: string | null;
}) {
  const { error } = await getSupabaseServiceClient().from("email_log").insert({
    to_address: input.to,
    template_key: input.templateKey,
    subject: input.subject,
    status: row.status,
    provider: "smtp",
    provider_message_id: row.providerMessageId ?? null,
    failure_reason: row.failureReason ?? null,
    tenant_id: input.tenantId ?? null,
    user_id: input.userId ?? null,
    dedupe_key: input.dedupeKey ?? null,
  });

  // 23505 means this exact send already succeeded — the dedupe index doing its job, not a fault.
  if (error && error.code !== "23505") {
    console.error("[email] could not write the delivery log", input.templateKey, error.message);
  }
}

/**
 * Sends one email and records the attempt either way.
 *
 * Deliberately does not throw. Every caller sits on a path where the email is a side effect of
 * something more important — creating a user, completing a signup — and failing that action
 * because a mail server was briefly unreachable would be the wrong trade. The delivery log is what
 * makes the failure visible instead of silent, which is the part that was missing before.
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailDelivery> {
  const configured = readConfig();

  if (!configured.ok) {
    const reason = `email_not_configured: ${configured.missing.join(", ")}`;
    console.warn(`[email] ${input.templateKey} to ${input.to} not sent — ${reason}`);
    await record(input, { status: "skipped", failureReason: reason });
    return { delivered: false, reason: "email_not_configured" };
  }

  const { config } = configured;

  try {
    const info = await transporterFor(config).sendMail({
      // Gmail rewrites From to the authenticated account unless the address is a verified
      // "send as" alias, so a mismatch here shows up as the wrong sender rather than an error.
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
    });

    await record(input, { status: "sent", providerMessageId: info.messageId });
    return { delivered: true, providerId: info.messageId };
  } catch (error) {
    const reason = safeReason(error);
    console.error(`[email] ${input.templateKey} to ${input.to} failed — ${reason}`);
    await record(input, { status: "failed", failureReason: reason });
    return { delivered: false, reason: "provider_rejected" };
  }
}

/** Proves the credentials and the connection without sending anything. */
export async function verifyEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  const configured = readConfig();
  if (!configured.ok) return { ok: false, error: `Not configured: ${configured.missing.join(", ")}` };

  try {
    await transporterFor(configured.config).verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: safeReason(error) };
  }
}
