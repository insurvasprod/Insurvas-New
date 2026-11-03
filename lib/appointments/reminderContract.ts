import { formatInTimezone } from "../callbacks/timezone.ts";

export type AppointmentReminderTimes = {
  customerLocal: string;
  agentLocal: string;
  customerTimezone: string;
  agentTimezone: string;
};

export function appointmentReminderTimes(input: { startsAtUtc: string; customerTimezone: string; agentTimezone: string }): AppointmentReminderTimes {
  return {
    customerLocal: formatInTimezone(input.startsAtUtc, input.customerTimezone),
    agentLocal: formatInTimezone(input.startsAtUtc, input.agentTimezone),
    customerTimezone: input.customerTimezone,
    agentTimezone: input.agentTimezone,
  };
}

/**
 * LA-2.11 "to the customer, if there is consent and a channel". The channel is an email address;
 * the consent is a consent certificate on the lead that is still good — claimed (we hold the words)
 * or pending (the provider's link, not yet claimed). An expired or failed certificate is not
 * consent, and a lead with none gets no customer reminder, only the agent's.
 */
export const CUSTOMER_REMINDER_CONSENT_STATUSES = ["claimed", "pending"] as const;

export function customerReminderAllowed(input: { email: string | null; certificateStatuses: readonly string[] }): boolean {
  if (!input.email) return false;
  return input.certificateStatuses.some((status) => (CUSTOMER_REMINDER_CONSENT_STATUSES as readonly string[]).includes(status));
}

export function appointmentReminderEventKey(appointmentId: string, recipientType: "agent" | "customer", recipientKey: string) {
  return `appointment-reminder:${appointmentId}:${recipientType}:${recipientKey.toLowerCase()}`;
}
