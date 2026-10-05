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
  /**
   * One short line under the tab's title (2026-09-28 review: no explanatory copy). Search keeps the
   * long `description`; the tab shows this when it is set.
   */
  short?: string;
  /** Shown, selectable and locked: the page explains where this is managed instead. Never searchable. */
  managed?: string;
  disabled?: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { group: "Agency", id: "agency-profile", label: "Agency profile", description: "Who the agency is on a carrier application, and the health of what it is contracted to sell.", short: "The agency's legal identity and what it is contracted to sell." },
  { group: "Agency", id: "carrier-library", label: "Carrier library", description: "Carriers, contract levels, commission schedules and advance rules. Everything the ledger multiplies by.", short: "Carriers, contract levels, commission schedules and advance rules." },
  { group: "Agency", id: "states-licences", label: "States & licences", description: "Appointments, resident and non-resident licences, E&O cover and continuing education, in one place.", short: "Licences, carrier appointments, E&O cover and continuing education." },
  { group: "Agency", id: "team-access", label: "Team & access", description: "Owners, licensed agents, setters, assistants and bookkeepers — and the boundary each one works inside.", short: "Who is on the workspace, their role and where they are licensed." },
  { group: "How you call", id: "calendar", label: "Calendar & availability", description: "Working hours, blocked time and how many appointments fit in a day. Every booking rule reads these." },
  { group: "How you call", id: "cadence", label: "Dialing cadence", description: "How long the dialer waits before each retry, and which part of the day it prefers." },
  { group: "How you call", id: "calling-windows", label: "Calling windows", description: "The hours your agency will dial in, on top of the federal and state limits. Narrowing only." },
  { group: "How you call", id: "queue-sla", label: "Queue & SLA", description: "The unclaimed-lead response ladder. These thresholds drive Agent Floor, alerts, partner notice and expiry.", short: "How long a claimable lead may wait before each step of the response ladder." },
  { group: "How leads arrive and move", id: "lead-posting", label: "Lead posting", description: "The keys your vendors post with, the URL they post to, and how their field names map onto yours.", short: "Vendor posting keys, the URL they post to and their field maps." },
  { group: "How leads arrive and move", id: "pipelines", label: "Pipelines", description: "Stages for inbound, outbound and partner work — and which disposition moves a lead into each one.", short: "Pipelines, their stages, and the stage each disposition moves a lead to." },
  { group: "How leads arrive and move", id: "dispositions", label: "Dispositions", description: "Call outcomes, what each one counts as, and what happens next." },
  { group: "How leads arrive and move", id: "form-templates", label: "Form templates", description: "The partner and agent forms that capture a complete lead, before anybody calls it." },
  { group: "Sales", id: "sales-carriers", label: "Carriers and products", description: "The carrier library, plus the four things an application needs from a carrier that a contract does not carry: a portal, a reference shape, a descriptor and a payment method." },
  { group: "Sales", id: "sales-underwriting", label: "Underwriting templates", description: "The health questions an agent reads on the Interview step, and which answers put a carrier out of reach." },
  { group: "Sales", id: "sales-quotation", label: "Quotation templates", description: "What the Quote step asks for before an agent can record a premium against a carrier and product." },
  { group: "Sales", id: "sales-field-sets", label: "Application field sets", description: "The list of things a carrier asks for on paper, named once so the workspace, the QA checks and the extension all mean the same field." },
  { group: "Sales", id: "sales-field-maps", label: "Carrier field maps", description: "Where each application field goes on a carrier's site, verified before the extension fills it." },
  { group: "Sales", id: "sales-disclosures", label: "Disclosures", description: "The disclosures an application may need, and the rules that make each one required." },
  { group: "Sales", id: "sales-preferences", label: "Quote & QA rules", description: "Quote plausibility, appointment checks, draft-day buffer, requirement ageing and when the welcome pack goes." },
  { group: "Sales", id: "sales-welcome-pack", label: "Welcome pack", description: "The email a client gets after submit, so their first draft is never a surprise." },
  { group: "Sales", id: "sales-pipeline-sync", label: "Pipeline sync", description: "Which pipeline stage a lead's card moves to as its application progresses." },
  { group: "Sales", id: "sales-ai", label: "AI assistant", description: "The underwriting assistant, and exactly what it would be sent." },
  { group: "Sales", id: "sales-extension", label: "Browser extension", description: "The extension's install state, the carrier sites it may work on, and its recent access grants." },
  { group: "Managed elsewhere", id: "alerts", label: "Alerts", description: "Alert preferences are not set here, and the page says where they are instead of showing empty controls.", managed: "Set per person from the bell in the top bar, not per workspace.", short: "Alert preferences are personal — open them from the bell in the top bar." },
  { group: "Managed elsewhere", id: "billing", label: "Billing", description: "Billing is not changed here, and the page says who does it instead of showing empty controls.", managed: "This workspace is billed by Insurvas staff, so invoices and plan changes are not editable here.", short: "Billing is handled by Insurvas — contact support to change your plan." },
];
