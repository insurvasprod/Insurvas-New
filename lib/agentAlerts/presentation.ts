import type { Treatment } from "../notify/treatments.ts";

/** The treatments a person can actually be given a switch for. */
export type AudibleTreatment = Extract<Treatment, "win" | "arrive" | "warn" | "block">;

/**
 * The events the bell's own settings row (`agent_notification_settings.enabled_events`) has a key
 * for. Which events reach the bell is now Settings › Notifications' to say (LA-8.4); these keys stay
 * so the stored row and its PUT schema keep their shape.
 */
export const AGENT_ALERT_EVENTS = [
  "new_lead",
  "handoff_offered",
  "unclaimed_escalation",
  "callback_due",
  "mentioned",
  "partner_message",
] as const;

export type AgentAlertSettingEvent = (typeof AGENT_ALERT_EVENTS)[number];

/**
 * Events registered after the bell was built (lib/notifications/events.ts). They reach the bell as
 * notifications addressed to you; they have no key in the legacy settings row.
 */
export const REGISTRY_ALERT_EVENTS = [
  "servicing_failed",
  "reinstatement_closing",
  "doi_deadline",
  "credential_expiring",
  "plan_payment_failed",
  "webhook_disabled",
  "allowance_near_cap",
] as const;

export type AgentAlertEvent = AgentAlertSettingEvent | (typeof REGISTRY_ALERT_EVENTS)[number];

/**
 * Registered as protected (cannot be switched off) — missing one causes harm that does not come
 * back. The bell draws them as warnings. Kept in step with `is_protected` by presentation.test.mjs.
 */
export const PROTECTED_ALERT_EVENTS: readonly AgentAlertEvent[] = ["reinstatement_closing", "doi_deadline", "credential_expiring", "plan_payment_failed"];

/**
 * Wrong with the workspace rather than addressed to a person, most severe first — the order the
 * alerts panel draws them in. Both are about a lead nobody has claimed, so both clear when
 * somebody claims it, and never because somebody read them.
 */
export const WORKSPACE_ALERT_EVENTS: readonly AgentAlertEvent[] = ["unclaimed_escalation", "new_lead"];

/**
 * How long a live offer stays in the feed unread. A handoff is "on the line now"; ten minutes later
 * the caller has gone and the row would be a false prompt. Every other notification is addressed to
 * you and stays until you read it (up to the backstop below) — a mention nobody opened must not
 * quietly disappear. Alerts stay until resolved.
 */
export const PERSONAL_ALERT_WINDOW_MS = 10 * 60_000;
const LIVE_OFFER_EVENTS: readonly AgentAlertEvent[] = ["handoff_offered"];
/** A backstop, not a timeout: an alert for a lead still unclaimed after a day is not live news. */
export const WORKSPACE_ALERT_WINDOW_MS = 24 * 60 * 60_000;

/** Every workspace alert links to its lead; that link is the only place the lead id is kept. */
export function leadIdFromAlertLink(link: string): string | null {
  const match = /^\/app\/leads\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(link);
  return match ? match[1] : null;
}

/**
 * Which rows the feed shows. A personal notification shows while unread (a live offer only while recent). A workspace
 * alert shows while its lead is still unclaimed — `unclaimedLeadIds` is that set, read from the
 * queue. One whose lead cannot be identified falls back to the personal window rather than
 * staying forever on a guess. Returns the resolved alerts separately so the caller can retire them.
 */
export function partitionAlertRows<T extends { link: string; created_at: string; event_type: AgentAlertEvent }>(
  rows: T[],
  unclaimedLeadIds: ReadonlySet<string>,
  now: number,
): { live: T[]; resolved: T[] } {
  const live: T[] = [];
  const resolved: T[] = [];
  for (const row of rows) {
    const age = now - new Date(row.created_at).getTime();
    if (!WORKSPACE_ALERT_EVENTS.includes(row.event_type)) {
      const window = LIVE_OFFER_EVENTS.includes(row.event_type) ? PERSONAL_ALERT_WINDOW_MS : WORKSPACE_ALERT_WINDOW_MS;
      if (age <= window) live.push(row);
      continue;
    }
    const leadId = leadIdFromAlertLink(row.link);
    if (!leadId) { if (age <= PERSONAL_ALERT_WINDOW_MS) live.push(row); continue; }
    (unclaimedLeadIds.has(leadId) ? live : resolved).push(row);
  }
  return { live, resolved };
}

export type AgentAlertSettings = {
  enabled_events: Record<AgentAlertSettingEvent, boolean>;
  do_not_disturb: boolean;
  sound_muted: boolean;
  sound_volume: number;
  /**
   * Per-treatment sound opt-in. A missing key means "no opinion" — use AUDIBLE_BY_DEFAULT.
   *
   * Only the four treatments that can ever be audible may appear; `done` and `fail` are silent by
   * design, and a key for them would imply a control that does not exist.
   */
  sound_treatments: Partial<Record<AudibleTreatment, boolean>>;
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
  // Empty, not pre-filled with the defaults. "No opinion" and "explicitly chose what the default
  // happens to be today" must stay distinguishable, or changing a default silently fails to reach
  // everyone who never touched the setting.
  sound_treatments: {},
};

export function eventTypeForKind(kind: string): AgentAlertEvent | null {
  if (kind === "new_unclaimed_lead") return "new_lead";
  if (kind === "handoff_offered") return "handoff_offered";
  if (kind === "unclaimed_sla_escalation") return "unclaimed_escalation";
  if (kind === "callback_reminder") return "callback_due";
  if (kind === "appointment_reminder") return "callback_due";
  if (kind === "lead_note_mention" || kind === "partner_message_mention") return "mentioned";
  if (kind === "partner_message") return "partner_message";
  // One kind each, and the event is named after it (lib/notifications/events.ts).
  if ((REGISTRY_ALERT_EVENTS as readonly string[]).includes(kind)) return kind as AgentAlertEvent;
  return null;
}

/** A poll can return a burst of events; delivery owns one sound for the whole batch. */
export function coalesceAlertBatch<T>(alerts: T[]): { alerts: T[]; playSound: boolean } {
  return { alerts, playSound: alerts.length > 0 };
}
