import { appointmentExpiryWarningEmail } from "./templates.ts";
import { sendEmail, type EmailDelivery } from "./transport.ts";

export async function sendExpiryWarning(input: { to: string; userId: string; tenantId: string; name: string; label: string; days: number; expiresAt: string; settingsUrl: string; dedupeKey: string }): Promise<EmailDelivery> {
  const body = appointmentExpiryWarningEmail(input);
  return sendEmail({ ...body, to: input.to, userId: input.userId, tenantId: input.tenantId, dedupeKey: input.dedupeKey, templateKey: "agent.expiry_warning" });
}
