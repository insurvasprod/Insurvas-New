/**
 * The settings page's sections, in rail order.
 *
 * Its own module because two things read it: the settings page draws the rail from it, and search
 * offers each section as a destination. One list means search can never name a section the page
 * does not have, or miss one it does.
 *
 * Groups must stay contiguous. AgentSettingsTabs starts a new run every time `group` changes,
 * deliberately, so the rail's order always matches the page's — which means an interleaved list
 * renders the same heading twice. `lead-posting` and `queue-sla` were on each other's side of the
 * boundary, so the rail showed "How you call" and "How leads arrive and move" as two sections each.
 */
export type SettingsSection = {
  id: string;
  label: string;
  description: string;
  group?: string;
  /** Shown, selectable and locked: the page explains where this is managed instead. Never searchable. */
  managed?: string;
  disabled?: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { group: "Agency", id: "agency-profile", label: "Agency profile", description: "Who the agency is on a carrier application, and the health of what it is contracted to sell." },
  { group: "Agency", id: "carrier-library", label: "Carrier library", description: "Carriers, contract levels, commission schedules and advance rules. Everything the ledger multiplies by." },
  { group: "Agency", id: "states-licences", label: "States & licences", description: "Appointments, resident and non-resident licences, E&O cover and continuing education, in one place." },
  { group: "Agency", id: "team-access", label: "Team & access", description: "Owners, licensed agents, setters, assistants and bookkeepers — and the boundary each one works inside." },
  { group: "How you call", id: "calendar", label: "Calendar & availability", description: "Working hours, blocked time and how many appointments fit in a day. Every booking rule reads these." },
  { group: "How you call", id: "cadence", label: "Dialing cadence", description: "How long the dialer waits before each retry, and which part of the day it prefers." },
  { group: "How you call", id: "calling-windows", label: "Calling windows", description: "The hours your agency will dial in, on top of the federal and state limits. Narrowing only." },
  { group: "How you call", id: "queue-sla", label: "Queue & SLA", description: "The unclaimed-lead response ladder. These thresholds drive Agent Floor, alerts, partner notice and expiry." },
  { group: "How leads arrive and move", id: "lead-posting", label: "Lead posting", description: "The keys your vendors post with, the URL they post to, and how their field names map onto yours." },
  { group: "How leads arrive and move", id: "pipelines", label: "Pipelines", description: "Stages for inbound, outbound and partner work — and which disposition moves a lead into each one." },
  { group: "How leads arrive and move", id: "dispositions", label: "Dispositions", description: "Call outcomes, what each one counts as, and what happens next." },
  { group: "How leads arrive and move", id: "form-templates", label: "Form templates", description: "The partner and agent forms that capture a complete lead, before anybody calls it." },
  { group: "Managed elsewhere", id: "alerts", label: "Alerts", description: "Alert preferences are not set here, and the page says where they are instead of showing empty controls.", managed: "Set per person from the bell in the top bar, not per workspace." },
  { group: "Managed elsewhere", id: "billing", label: "Billing", description: "Billing is not changed here, and the page says who does it instead of showing empty controls.", managed: "This workspace is billed by Insurvas staff, so invoices and plan changes are not editable here." },
];
