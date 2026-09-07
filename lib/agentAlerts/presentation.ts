export const AGENT_ALERT_EVENTS = [
  "new_lead",
  "handoff_offered",
  "unclaimed_escalation",
  "callback_due",
  "mentioned",
  "partner_message",
] as const;

export type AgentAlertEvent = (typeof AGENT_ALERT_EVENTS)[number];

export type AgentAlertSettings = {
  enabled_events: Record<AgentAlertEvent, boolean>;
  do_not_disturb: boolean;
  sound_muted: boolean;
  sound_volume: number;
};

export const DEFAULT_AGENT_ALERT_SETTINGS: AgentAlertSettings = {
  enabled_events: {
    new_lead: true,
    handoff_offered: true,
    unclaimed_escalation: true,
    callback_due: true,
    mentioned: true,
    partner_message: true,
  },
  do_not_disturb: false,
  sound_muted: false,
  sound_volume: 70,
};

export function eventTypeForKind(kind: string): AgentAlertEvent | null {
  if (kind === "new_unclaimed_lead") return "new_lead";
  if (kind === "handoff_offered") return "handoff_offered";
  if (kind === "unclaimed_sla_escalation") return "unclaimed_escalation";
  if (kind === "callback_reminder") return "callback_due";
  if (kind === "lead_note_mention" || kind === "partner_message_mention") return "mentioned";
  if (kind === "partner_message") return "partner_message";
  return null;
}

/** A poll can return a burst of events; delivery owns one sound for the whole batch. */
export function coalesceAlertBatch<T>(alerts: T[]): { alerts: T[]; playSound: boolean } {
  return { alerts, playSound: alerts.length > 0 };
}
