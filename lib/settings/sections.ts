import type { TenantRole } from "@/lib/tenantAuth/roles";

/**
 * The settings registry (LA-8.1, Notion sprint): every settings section, wherever it lives.
 *
 * A registry, not settings storage. Each entry says what a section is called, which of the six
 * fixed groups it sits in, who may open it and where it actually lives — LA-8 owns no setting in
 * here and reads no value from one. A module adds a section by adding an entry; the shell
 * (components/app/agent-settings-tabs.tsx), its gating and search (lib/settings/registry.ts) do not
 * change. lib/settings/registry.test.mjs registers a made-up section and proves that.
 *
 * Two kinds of entry:
 *   · `route` absent — a panel drawn inside /app/settings, from components/app/settings/panels.tsx.
 *   · `route` set — another module's own screen. The shell links to it; it never copies its
 *     controls, because two screens claiming one setting drift and the wrong one gets believed.
 *
 * Gating is the menu's: `required_feature` AND `required_roles`, and a section that fails either is
 * absent, never greyed out. Each in-page section carries the gate its own API already enforces, so
 * the rail never offers a door that answers 403.
 *
 * `items` exist only so search can land on one setting rather than the top of its page. `anchor` is
 * the element id on the section's screen (an in-page panel's control id, or a hub's own section id);
 * lib/settings/registry.test.mjs checks every anchor is present in the source.
 *
 * Keep each group's entries together: components/app/settingsGroupsAreContiguous.test.mjs reads
 * this file as text. (The rail itself orders by group, then `sort_order`.)
 */
// Seven short groups (owner decision 2026-10-15, after the LA-8 walk: Selling had nineteen entries and
// pushed the last sections off the screen). None holds more than eight.
export type SettingsGroup = "Your account" | "Agency" | "Carriers" | "Sales process" | "Leads & dialing" | "Money & compliance" | "Platform";

export type SettingsItem = {
  label: string;
  /** Element id on the section's screen. */
  anchor: string;
  keywords?: readonly string[];
};

export type SettingsSection = {
  /** The registry key; also the #hash of an in-page panel. */
  id: string;
  label: string;
  description: string;
  group: SettingsGroup;
  /** Another module's screen. Absent: a panel inside /app/settings. */
  route?: string;
  required_feature?: string;
  required_roles?: readonly TenantRole[];
  search_keywords?: readonly string[];
  items?: readonly SettingsItem[];
  sort_order: number;
  /** The Notion task that owns the setting — LA-8 only for the sections LA-8 builds. */
  owned_by_module: string;
  /**
   * One short line under the tab's title (2026-09-28 review: no explanatory copy). Search keeps the
   * long `description`; the tab shows this when it is set.
   */
  short?: string;
  /** Shown, selectable and locked: the page explains where this is managed instead. */
  managed?: string;
  disabled?: string;
};

const OWNER: readonly TenantRole[] = ["owner"];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  // ── Your account ────────────────────────────────────────────────────────────────────────────────
  {
    // Redesign 2026-10-27 (owner pick A): the profile lives here, not on a page of its own, and
    // Notifications are part of it — four tabs (components/app/settings/my-profile.tsx). /app/profile
    // and the old "#alerts" land here.
    group: "Your account", id: "my-profile", label: "My profile", sort_order: 10, owned_by_module: "LA-8.2 / LA-8.4",
    description: "Your name, phone, photo and licence numbers; how you sign in; and which alerts reach you, in the app, by email or in the browser.",
    short: "You, how you sign in, and which alerts reach you.",
    search_keywords: ["profile", "my name", "phone number", "avatar", "photo", "licence number", "npn", "security", "alerts", "notifications", "email alerts", "browser alerts", "push", "digest", "daily email", "weekly email", "too many emails"],
    items: [
      { label: "Display timezone", anchor: "profile-timezone", keywords: ["my timezone", "time zone", "display time"] },
      { label: "Languages I speak", anchor: "profile-languages", keywords: ["language", "languages", "spanish", "bilingual", "speak"] },
      { label: "Sign-in email", anchor: "security-email", keywords: ["change email", "email address", "login email"] },
      { label: "Password", anchor: "security-password", keywords: ["change password", "reset password"] },
      { label: "Two-factor authentication", anchor: "security-two-factor", keywords: ["2fa", "two factor", "authenticator", "mfa", "recovery codes"] },
      { label: "Sessions", anchor: "security-sessions", keywords: ["sign out", "log out", "devices", "lost laptop", "stolen phone", "end session"] },
      { label: "Security log", anchor: "security-log", keywords: ["login history", "failed logins", "security events"] },
      { label: "Quiet hours", anchor: "notify-quiet-hours", keywords: ["quiet hours", "do not disturb at night", "mute at night"] },
      { label: "Alerts that cannot be switched off", anchor: "notify-protected", keywords: ["doi deadline", "reinstatement", "licence expiring", "payment failed", "cannot switch off"] },
    ],
  },

  // ── Agency ──────────────────────────────────────────────────────────────────────────────────────
  {
    group: "Agency", id: "business-identity", label: "Business identity", sort_order: 10, owned_by_module: "LA-8.3", required_roles: OWNER,
    description: "Who the business is on every document: trading and legal name, NPN, tax ID, address, phone, logo and timezone — plus the support contact partners see, and who owns the workspace.", short: "Who the business is, on every document it produces.",
    search_keywords: ["business", "agency name", "company name", "doing business as", "dba", "ein", "agency profile", "support contact", "partner support", "owner", "ownership", "workspace id"],
    items: [
      { label: "Trading name", anchor: "identity-trading-name", keywords: ["trading name", "dba", "doing business as", "brand name"] },
      { label: "Legal name", anchor: "identity-legal-name", keywords: ["legal name", "llc", "entity name"] },
      { label: "National Producer Number", anchor: "identity-npn", keywords: ["npn", "producer number"] },
      { label: "Tax ID", anchor: "identity-tax-id", keywords: ["tax id", "ein", "tin", "federal tax"] },
      { label: "Business address", anchor: "identity-address-line1", keywords: ["address", "mailing address", "office"] },
      { label: "Business phone", anchor: "identity-phone", keywords: ["phone", "business phone"] },
      { label: "Logo", anchor: "identity-logo", keywords: ["logo", "branding", "brand"] },
      { label: "Business timezone", anchor: "identity-timezone", keywords: ["timezone", "time zone", "daily summary time"] },
      { label: "Partner support contact", anchor: "identity-partner-support", keywords: ["support contact", "partner support", "support email", "support phone"] },
      { label: "Ownership", anchor: "identity-ownership", keywords: ["owner", "workspace owner", "workspace id"] },
    ],
  },
  {
    // Owner pick A, 2026-10-27: the products the agency sells, from the Insurvas catalogue and within the plan.
    group: "Agency", id: "products", label: "Products", sort_order: 15, owned_by_module: "LA-1.3", required_roles: OWNER,
    description: "The products your agency sells, from the Insurvas catalogue and within your plan. Leads, partners, forms, quotes and reports offer only these.",
    short: "Which products your agency sells.",
    search_keywords: ["products", "product", "final expense", "term life", "whole life", "iul", "medicare", "annuity", "what we sell", "product lines", "products you sell"],
    items: [{ label: "Products you sell", anchor: "products-list", keywords: ["products you sell", "sell", "turn on", "turn off"] }],
  },
  { group: "Agency", id: "team-access", label: "Team & access", sort_order: 20, owned_by_module: "LA-0.2", required_roles: OWNER, description: "Owners, licensed agents, setters, assistants and bookkeepers — and the boundary each one works inside.", short: "Who is on the workspace, their role and where they are licensed.", search_keywords: ["team", "users", "staff", "invite", "seats", "roles", "members", "deactivate"] },
  {
    group: "Agency", id: "billing", label: "Plan & billing", sort_order: 40, owned_by_module: "LA-8.5", required_roles: OWNER,
    description: "Your plan, what it costs and when it renews, every limit with what you use of it, invoices, the card, and changing, pausing or cancelling.",
    short: "Your plan, limits, invoices and card — and changing, pausing or cancelling.",
    search_keywords: ["billing", "plan", "subscription", "invoice", "receipt", "upgrade", "downgrade", "cancel", "pause", "card", "payment method", "usage", "limits", "seats", "renewal"],
    items: [
      { label: "Usage and limits", anchor: "billing-limits", keywords: ["usage", "limits", "seats used", "minutes left", "quota"] },
      { label: "Invoices", anchor: "billing-invoices", keywords: ["invoices", "receipts", "download invoice", "pdf"] },
      { label: "Update card", anchor: "billing-card", keywords: ["card", "payment method", "update card", "failed payment"] },
      { label: "Change plan", anchor: "billing-plan", keywords: ["upgrade", "downgrade", "change plan"] },
      { label: "Pause or cancel", anchor: "billing-cancel", keywords: ["cancel", "pause", "close account", "export my data"] },
    ],
  },

  // ── Carriers ────────────────────────────────────────────────────────────────────────────────────
  // Owner pick D, 2026-10-26: Carrier library and States & licences in one place, in three steps.
  // 2026-10-27: Carrier details (sales-carriers) folded into each carrier's card; old links land on Carriers.
  { group: "Carriers", id: "carriers", label: "Carriers", sort_order: 10, owned_by_module: "LA-0.4 / LA-0.5", required_feature: "appointment_vault", required_roles: OWNER, description: "Your carriers and the states each one appointed you in.", short: "Carriers, contract levels and appointed states.", search_keywords: ["carriers", "contract level", "writing number", "appointments", "appointed", "states", "products", "carrier portal", "portal login", "bank descriptor", "payment method", "field map", "autofill"] },
  // 2026-10-27 (owner): Carrier rules is a tab on Carriers that opens /app/carrier-rules, not a rail entry.
  { group: "Carriers", id: "sales-extension", label: "Browser extension", sort_order: 50, owned_by_module: "LA-3.12", required_feature: "applications", required_roles: OWNER, description: "The extension's install state, the carrier sites it may work on, and its recent access grants.", search_keywords: ["extension", "chrome"] },

  // ── Sales process ───────────────────────────────────────────────────────────────────────────────
  { group: "Sales process", id: "sales-underwriting", label: "Underwriting templates", sort_order: 10, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER, description: "The health questions an agent reads on the Interview step, and which answers put a carrier out of reach.", search_keywords: ["underwriting", "health questions", "knockout"] },
  { group: "Sales process", id: "sales-quotation", label: "Quotation templates", sort_order: 20, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER, description: "What the Quote step asks for before an agent can record a premium against a carrier and product.", search_keywords: ["quote", "quotation", "premium"] },
  { group: "Sales process", id: "sales-field-sets", label: "Application field sets", sort_order: 30, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER, description: "The list of things a carrier asks for on paper, named once so the workspace, the QA checks and the extension all mean the same field.", search_keywords: ["application fields", "field set"] },
  { group: "Sales process", id: "sales-disclosures", label: "Disclosures", sort_order: 40, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER, description: "The disclosures an application may need, and the rules that make each one required.", search_keywords: ["disclosure", "script", "replacement"] },
  {
    group: "Sales process", id: "sales-preferences", label: "Quote & QA rules", sort_order: 50, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER,
    description: "Quote plausibility, appointment checks, draft-day buffer, requirement ageing and when the welcome pack goes.", search_keywords: ["qa", "quality"],
    items: [
      { label: "Quote plausibility band", anchor: "qa-band-min", keywords: ["premium per thousand", "plausibility", "quote check"] },
      { label: "A carrier we are not appointed with", anchor: "qa-appointment", keywords: ["not appointed", "appointment check"] },
      { label: "Draft-date buffer", anchor: "qa-buffer", keywords: ["draft date", "draft day", "first draft", "deposit"] },
      { label: "Requirement ageing", anchor: "qa-ageing", keywords: ["pending requirements", "ageing", "aging"] },
      { label: "Welcome pack sending", anchor: "qa-welcome", keywords: ["welcome pack", "auto send"] },
    ],
  },
  { group: "Sales process", id: "sales-welcome-pack", label: "Welcome pack", sort_order: 60, owned_by_module: "LA-3.20", required_feature: "applications", required_roles: OWNER, description: "The email a client gets after submit, so their first draft is never a surprise.", search_keywords: ["welcome email", "client email"] },
  { group: "Sales process", id: "sales-ai", label: "AI assistant", sort_order: 70, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER, description: "The underwriting assistant, and exactly what it would be sent.", search_keywords: ["ai", "assistant"] },
  { group: "Sales process", id: "sales-pipeline-sync", label: "Pipeline sync", sort_order: 80, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER, description: "Which pipeline stage a lead's card moves to as its application progresses.", search_keywords: ["stage sync"] },

  // ── Leads & dialing ─────────────────────────────────────────────────────────────────────────────
  // Pipelines and Dispositions are one page (owner, 2026-10-27); old "#dispositions" links land here (registry.ts).
  { group: "Leads & dialing", id: "pipelines", label: "Pipelines & outcomes", sort_order: 10, owned_by_module: "LA-1.9 / LA-1.12", required_feature: "book_of_business", required_roles: OWNER, description: "Your pipelines' stages, the call outcomes agents pick, and where each outcome sends the lead.", short: "Stages, call outcomes, and the stage each outcome moves a lead to.", search_keywords: ["stages", "pipeline", "call outcome", "disposition", "dispositions", "outcomes"] },
  { group: "Leads & dialing", id: "form-templates", label: "Form templates", sort_order: 30, owned_by_module: "LA-1.4", required_feature: "book_of_business", required_roles: OWNER, description: "The partner and agent forms that capture a complete lead, before anybody calls it.", search_keywords: ["lead fields", "forms", "application forms", "custom fields"] },
  { group: "Leads & dialing", id: "lead-posting", label: "Lead posting", sort_order: 40, owned_by_module: "LA-2.5", required_feature: "lead_import", required_roles: OWNER, description: "The keys your vendors post with, the URL they post to, and how their field names map onto yours.", short: "Vendor posting keys, the URL they post to and their field maps.", search_keywords: ["post key", "vendor key", "lead post", "posting url", "field map"] },
  { group: "Leads & dialing", id: "calendar", label: "Calendar & availability", sort_order: 50, owned_by_module: "LA-2.11", required_feature: "outbound_dialing", required_roles: OWNER, description: "Working hours, blocked time and how many appointments fit in a day. Every booking rule reads these.", search_keywords: ["working hours", "availability", "appointments per day", "blocked time"] },
  { group: "Leads & dialing", id: "cadence", label: "Dialing cadence", sort_order: 60, owned_by_module: "LA-2.7", required_feature: "outbound_dialing", required_roles: OWNER, description: "How long the dialer waits before each retry, and which part of the day it prefers.", search_keywords: ["retry", "redial", "cadence"] },
  { group: "Leads & dialing", id: "queue-sla", label: "Inbound transfers", sort_order: 70, owned_by_module: "LA-1.23", required_feature: "book_of_business", required_roles: OWNER, description: "How long a transfer may wait and what happens at each step, who hears about it, buffer handoff, and who gets the next transfer.", short: "Waiting time, alerts, buffer agents and who gets the next transfer.", search_keywords: ["sla", "unclaimed", "response time", "escalation ladder", "inbound", "transfers", "buffer", "handoff", "routing", "licensed", "break", "alerts", "queue"] },
  { group: "Leads & dialing", id: "calling-windows", label: "Calling windows", sort_order: 80, owned_by_module: "LA-2.4", required_feature: "outbound_dialing", required_roles: OWNER, description: "The hours your agency will dial in, on top of the federal and state limits. Narrowing only.", search_keywords: ["calling hours", "dialing hours", "tcpa hours", "holidays", "quiet hours"] },

  // ── Money & compliance ──────────────────────────────────────────────────────────────────────────
  {
    group: "Money & compliance", id: "accounting", label: "Accounting", sort_order: 10, owned_by_module: "LA-7.9", route: "/app/accounting-settings", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"],
    description: "Reporting basis, acquisition or overhead, partner payouts, producer splits, bank matching and tax.", search_keywords: ["accounting", "p&l", "profit and loss"],
    items: [
      { label: "Reporting basis and fiscal year", anchor: "reporting", keywords: ["cash", "accrual", "basis", "fiscal year", "persistency month"] },
      { label: "Acquisition or overhead", anchor: "acquisition-or-overhead", keywords: ["cost per policy", "expense category", "overhead", "acquisition cost"] },
      { label: "Partner payout cadence", anchor: "partner-payouts", keywords: ["owe", "payout", "pay partner", "partner statement", "cadence", "statement footer"] },
      { label: "Producer splits", anchor: "producer-splits", keywords: ["split", "producer share", "negative balance", "carry forward"] },
      { label: "Bank matching tolerance", anchor: "bank-matching", keywords: ["bank", "deposit", "tolerance", "reconcile"] },
      { label: "Tax and 1099 threshold", anchor: "tax", keywords: ["1099", "tax id", "threshold"] },
    ],
  },
  {
    group: "Money & compliance", id: "retention", label: "Retention", sort_order: 15, owned_by_module: "LA-5.11", route: "/app/retention-settings", required_feature: "chargeback_radar", required_roles: OWNER,
    description: "Everything the chargeback radar, the save queue and the retention campaigns read: scoring weights, band thresholds, queue size, cooling-off periods, the holdout and who works retention.", search_keywords: ["retention", "chargeback radar", "save queue", "lapse"],
    items: [
      { label: "Scoring weights", anchor: "weights", keywords: ["weights", "risk score", "signal weight", "retune"] },
      { label: "Band thresholds", anchor: "thresholds", keywords: ["critical", "high risk", "band", "threshold"] },
      { label: "Queue behaviour", anchor: "queue", keywords: ["cooldown", "max cards", "default sort"] },
      { label: "Signal settings", anchor: "signals", keywords: ["sample floor", "affordability", "danger window", "months since issue"] },
      { label: "Paper-bill campaign", anchor: "campaigns", keywords: ["talk track", "paper bill", "direct bill", "cooling-off"] },
      { label: "Reinstatement countdown", anchor: "reinstatement", keywords: ["reinstatement", "escalation", "deadline"] },
      { label: "Win-back cooling-off", anchor: "winback", keywords: ["win-back", "winback", "cooling-off", "affordability period"] },
      { label: "Holdout", anchor: "holdout", keywords: ["holdout", "experiment", "control group", "effectiveness"] },
      { label: "Retention roles and assignment", anchor: "assignment", keywords: ["retention rep", "round-robin", "assignment", "by carrier", "by exposure"] },
    ],
  },
  {
    group: "Money & compliance", id: "compliance", label: "Compliance", sort_order: 20, owned_by_module: "LA-6.8", route: "/app/compliance/settings", required_feature: "tcpa_checker", required_roles: OWNER,
    description: "Complaint deadlines, record retention, legal holds, deletion requests and the transfer gate.", search_keywords: ["compliance"],
    items: [
      { label: "Complaint response deadlines", anchor: "deadlines", keywords: ["doi", "complaint", "regulator", "response days", "escalation"] },
      { label: "Record retention rules", anchor: "retention", keywords: ["record retention", "keep records", "purge rule"] },
      { label: "Purge job", anchor: "purge", keywords: ["purge", "dry run"] },
      { label: "Legal holds", anchor: "holds", keywords: ["legal hold", "litigation"] },
      { label: "Deletion requests", anchor: "deletion", keywords: ["delete my data", "ccpa", "data subject"] },
      { label: "Transfer gate", anchor: "gate", keywords: ["dnc", "do not call", "consent", "transfer check", "scrub"] },
      { label: "Evidence report", anchor: "report", keywords: ["evidence", "audit report"] },
      { label: "Compliance dashboard and monthly email", anchor: "dashboard", keywords: ["monthly email", "dashboard"] },
    ],
  },

  // ── Platform ────────────────────────────────────────────────────────────────────────────────────
  {
    group: "Platform", id: "integrations", label: "API keys & webhooks", sort_order: 10, owned_by_module: "LA-8.7", required_roles: OWNER,
    description: "Keys that let another system post leads in or read your book, and webhooks that send policy and commission events out.",
    short: "Integration keys, their scopes and last use, and signed webhooks.",
    search_keywords: ["api", "api key", "integration", "webhook", "zapier", "developer", "token", "signing secret"],
  },
  {
    group: "Platform", id: "settings-history", label: "Settings history", sort_order: 20, owned_by_module: "LA-8.8", required_roles: OWNER,
    description: "Who changed which setting, from what to what, and when. Read only, and kept for good.",
    short: "Every settings change: who, what, from, to, when.",
    search_keywords: ["audit", "audit log", "history", "who changed", "settings changes", "change log"],
  },
];
