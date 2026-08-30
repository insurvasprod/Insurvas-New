import "server-only";

type VerificationEmailInput = {
  email: string;
  name: string;
  verificationUrl: string;
  verificationId: string;
};

export type EmailDelivery = { delivered: true; providerId: string } | { delivered: false; reason: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Sends through Resend's HTTP API so no provider SDK is bundled into the application. */
export async function sendVerificationEmail(input: VerificationEmailInput): Promise<EmailDelivery> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("Verification email not sent: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
    return { delivered: false, reason: "email_not_configured" };
  }

  const safeName = escapeHtml(input.name);
  const safeUrl = escapeHtml(input.verificationUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `signup-verification-${input.verificationId}`,
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: "Verify your Insurvas email",
      html: `<div style="font-family:Inter,Arial,sans-serif;color:#1a1b1c;line-height:1.6"><h2>Welcome to Insurvas, ${safeName}</h2><p>Verify your work email to continue setting up your workspace.</p><p><a href="${safeUrl}" style="display:inline-block;background:#00407f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Verify email</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this message.</p></div>`,
      text: `Welcome to Insurvas, ${input.name}. Verify your email: ${input.verificationUrl}. This link expires in 24 hours.`,
      tags: [{ name: "message_type", value: "signup_verification" }],
    }),
  });

  const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok || !body?.id) {
    console.error("Resend verification email failed", response.status, body?.message ?? "Unknown error");
    return { delivered: false, reason: "provider_rejected" };
  }

  return { delivered: true, providerId: body.id };
}
