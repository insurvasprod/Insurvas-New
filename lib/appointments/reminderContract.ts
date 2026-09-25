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

export function appointmentReminderEventKey(appointmentId: string, recipientType: "agent" | "customer", recipientKey: string) {
  return `appointment-reminder:${appointmentId}:${recipientType}:${recipientKey.toLowerCase()}`;
}
