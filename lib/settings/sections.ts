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
// Seven short groups, named by job (settings round 8, owner pick 2026-11-12, the foundation board's
// "new frame"): Your account · Agency · Selling · Leads & calling · Integrations · Money & compliance ·
// Records. None holds more than eight.
// "Platform" is the round-7 name of Integrations + Records, kept only so the /design settings preview
// (components/design/settings-patterns.tsx) still compiles; no section uses it, and the rail draws it last.
export type SettingsGroup = "Your account" | "Agency" | "Selling" | "Leads & calling" | "Integrations" | "Money & compliance" | "Records" | "Platform";

export type SettingsItem = {
  label: string;
  /** Element id on the section's screen. */
  anchor: string;
  keywords?: readonly string[];
  /** A section open to several roles may hold settings only some of them reach (search skips the rest). */
  required_roles?: readonly TenantRole[];
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
      { label: "Two-step verification", anchor: "security-two-factor", keywords: ["2fa", "two factor", "two-factor", "two step", "authenticator", "mfa", "recovery codes"] },
      { label: "Sessions", anchor: "security-sessions", keywords: ["sign out", "log out", "devices", "lost laptop", "stolen phone", "end session"] },
      { label: "Sign-in history", anchor: "security-log", keywords: ["login history", "failed logins", "security events"] },
      { label: "Quiet hours", anchor: "notify-quiet-hours", keywords: ["quiet hours", "do not disturb at night", "mute at night"] },
      { label: "Alerts that cannot be switched off", anchor: "notify-protected", keywords: ["doi deadline", "reinstatement", "licence expiring", "payment failed", "cannot switch off"] },
    ],
  },

  {
    group: "Your account", id: "billing", label: "Plan & billing", sort_order: 30, owned_by_module: "LA-8.5", required_roles: OWNER,
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

  // ── Agency ──────────────────────────────────────────────────────────────────────────────────────
  // Round 8 (foundation board, 2026-11-12): who the business is, its people, what it sells and who for.
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
  { group: "Agency", id: "team-access", label: "Team & access", sort_order: 20, owned_by_module: "LA-0.2", required_roles: OWNER, description: "Owners, licensed agents, setters, assistants and bookkeepers — and the boundary each one works inside.", short: "Who is on the workspace, their role and where they are licensed.", search_keywords: ["team", "users", "staff", "invite", "seats", "roles", "members", "deactivate"] },
  // Owner pick A, 2026-10-27: the products the agency sells, from the Insurvas catalogue and within the plan.
  {
    group: "Agency", id: "products", label: "Products", sort_order: 30, owned_by_module: "LA-1.3", required_roles: OWNER,
    description: "The products your agency sells, from the Insurvas catalogue and within your plan. Leads, partners, forms, quotes and reports offer only these.",
    short: "Which products your agency sells.",
    search_keywords: ["products", "product", "final expense", "term life", "whole life", "iul", "medicare", "annuity", "what we sell", "product lines", "products you sell"],
    items: [{ label: "Products you sell", anchor: "products-list", keywords: ["products you sell", "sell", "turn on", "turn off"] }],
  },
  // Owner pick D, 2026-10-26: Carrier library and States & licences in one place; Carrier details folded into each
  // carrier's card (2026-10-27). Carrier rules is neither a rail entry nor a tab on Carriers (owner, 2026-10-28).
  { group: "Agency", id: "carriers", label: "Carriers", sort_order: 40, owned_by_module: "LA-0.4 / LA-0.5", required_feature: "appointment_vault", required_roles: OWNER, description: "The carriers you are contracted with and the states you sell in, set up step by step.", short: "Your carriers and the states you sell in, set up in two steps.", search_keywords: ["contracting", "contract management", "carriers", "add carrier", "contract level", "writing number", "appointments", "appointed", "states", "products", "carrier portal", "portal login", "bank descriptor", "payment method", "field map", "autofill"] },

  // ── Selling ─────────────────────────────────────────────────────────────────────────────────────
  // Settings round 8 (owner pick A, sales-process board, 2026-11-12): the six pages that shape an agent's call
  // are one section, its header tabs in call order. The old ids (sales-underwriting, sales-quotation,
  // sales-field-sets, sales-preferences, sales-disclosures, sales-pipeline-sync) redirect to its tabs
  // (registry.ts MOVED_TABS); the items below let search land on a tab or on one control.
  {
    group: "Selling", id: "sales-process", label: "Sales process", sort_order: 10, owned_by_module: "LA-3.17", required_feature: "applications",
    // Producers read Health questions (owner 2026-10-30, step S13): "what you'll ask on a call", read-only; the API already serves them.
    required_roles: ["owner", "producer"],
    description: "Everything that shapes an agent's call, step by step: the health questions, what the Quote step asks, each carrier's application, the checks on a case, the disclosures and where a lead's card moves.",
    short: "The call, step by step: health questions, quote inputs, carrier applications, checks, disclosures and stage moves.",
    search_keywords: ["sales process", "underwriting", "underwriting templates", "quote", "quotation", "quotation templates", "premium", "field set", "application field sets", "application fields", "qa", "quality", "quote and qa rules", "disclosure", "pipeline sync", "application stages", "stage sync", "move cards"],
    items: [
      { label: "Health questions", anchor: "health-questions", keywords: ["underwriting", "underwriting templates", "health questions", "knockout", "interview"] },
      { label: "Quote inputs", anchor: "quote-inputs", keywords: ["quotation templates", "quote inputs", "face amount", "age basis", "quote valid"], required_roles: OWNER },
      { label: "Carrier application", anchor: "carrier-application", keywords: ["application field sets", "field set", "required fields", "carrier form", "autofill"], required_roles: OWNER },
      { label: "Quote & case checks", anchor: "checks", keywords: ["quote and qa rules", "qa rules", "checks", "plausibility"], required_roles: OWNER },
      { label: "Disclosures", anchor: "disclosures", keywords: ["disclosure", "script", "replacement", "call script", "acknowledgement"], required_roles: OWNER },
      { label: "Stage moves", anchor: "stage-moves", keywords: ["application stages", "pipeline sync", "stage sync", "move cards", "application status"], required_roles: OWNER },
      { label: "Quote plausibility band", anchor: "qa-band-min", keywords: ["premium per thousand", "plausibility", "quote check"], required_roles: OWNER },
      { label: "A carrier we are not appointed with", anchor: "qa-appointment", keywords: ["not appointed", "appointment check"], required_roles: OWNER },
      { label: "Draft-date buffer", anchor: "qa-buffer", keywords: ["draft date", "draft day", "first draft", "deposit"], required_roles: OWNER },
      { label: "Requirement ageing", anchor: "qa-ageing", keywords: ["pending requirements", "ageing", "aging"], required_roles: OWNER },
      { label: "Welcome pack sending", anchor: "qa-welcome", keywords: ["welcome pack", "auto send"], required_roles: OWNER },
    ],
  },
  {
    group: "Selling", id: "form-templates", label: "Application forms", sort_order: 20, owned_by_module: "LA-1.4", required_feature: "book_of_business", required_roles: OWNER,
    description: "The partner and agent forms that capture a complete lead, before anybody calls it.", search_keywords: ["lead fields", "forms", "application forms", "custom fields", "questions", "partner form"],
    items: [
      { label: "Who can apply", anchor: "form-who-can-apply", keywords: ["age limit", "eligibility", "minimum age", "maximum age", "how old"] },
      { label: "Parts of the form", anchor: "form-parts", keywords: ["section groups", "medical", "banking", "beneficiary", "signature"] },
      { label: "Lead steps", anchor: "form-lead-steps", keywords: ["stages", "which pipeline"] },
      { label: "Versions & updates", anchor: "form-versions", keywords: ["platform template", "Insurvas template", "form version", "form name"] },
    ],
  },
  { group: "Selling", id: "sales-ai", label: "AI assistant", sort_order: 30, owned_by_module: "LA-3.17", required_feature: "applications", required_roles: OWNER, description: "The underwriting assistant, and exactly what it would be sent.", search_keywords: ["ai", "assistant"] },
  { group: "Selling", id: "sales-welcome-pack", label: "Welcome pack", sort_order: 40, owned_by_module: "LA-3.20", required_feature: "applications", required_roles: OWNER, description: "The email a client gets after submit, so their first draft is never a surprise.", search_keywords: ["welcome email", "client email"],
    // Hidden from the menu and search for now (owner 2026-10-30); the panel and its data stay.
    disabled: "Hidden for now." },

  // ── Leads & calling ─────────────────────────────────────────────────────────────────────────────
  { group: "Leads & calling", id: "lead-posting", label: "Lead posting", sort_order: 10, owned_by_module: "LA-2.5", required_feature: "lead_import", required_roles: OWNER, description: "The keys your vendors post with, the URL they post to, and how their field names map onto yours.", short: "Vendor posting keys, the URL they post to and their field maps.", search_keywords: ["post key", "vendor key", "lead post", "posting url", "field map"] },
  { group: "Leads & calling", id: "cadence", label: "Dialing cadence", sort_order: 20, owned_by_module: "LA-2.7", required_feature: "outbound_dialing", required_roles: OWNER, description: "How long the dialer waits before each retry, and which part of the day it prefers.", search_keywords: ["retry", "redial", "cadence"] },
  { group: "Leads & calling", id: "calling-windows", label: "Calling windows", sort_order: 30, owned_by_module: "LA-2.4", required_feature: "outbound_dialing", required_roles: OWNER, description: "The hours your agency will dial in, on top of the federal and state limits. Narrowing only.", search_keywords: ["calling hours", "dialing hours", "tcpa hours", "holidays", "quiet hours"] },
  { group: "Leads & calling", id: "queue-sla", label: "Inbound settings", sort_order: 40, owned_by_module: "LA-1.23", required_feature: "book_of_business", required_roles: OWNER, description: "How long a transfer may wait and what happens at each step, who hears about it, buffer handoff, and who gets the next transfer.", short: "Waiting time, alerts, buffer agents and who gets the next transfer.", search_keywords: ["sla", "unclaimed", "response time", "escalation ladder", "inbound", "transfers", "buffer", "handoff", "routing", "licensed", "break", "alerts", "queue"] },
  { group: "Leads & calling", id: "calendar", label: "Calendar & availability", sort_order: 50, owned_by_module: "LA-2.11", required_feature: "outbound_dialing", required_roles: OWNER, description: "Working hours, blocked time and how many appointments fit in a day. Every booking rule reads these.", search_keywords: ["working hours", "availability", "appointments per day", "blocked time"] },
  // Pipelines and Dispositions are one page (owner, 2026-10-27); old "#dispositions" links land here (registry.ts).
  { group: "Leads & calling", id: "pipelines", label: "Pipelines & outcomes", sort_order: 60, owned_by_module: "LA-1.9 / LA-1.12", required_feature: "book_of_business", required_roles: OWNER, description: "Your pipelines' stages, the call outcomes agents pick, and where each outcome sends the lead.", short: "Stages, call outcomes, and the stage each outcome moves a lead to.", search_keywords: ["stages", "pipeline", "call outcome", "disposition", "dispositions", "outcomes"] },

  // ── Integrations ────────────────────────────────────────────────────────────────────────────────
  {
    group: "Integrations", id: "integrations", label: "Integrations", sort_order: 10, owned_by_module: "LA-8.7", required_roles: OWNER,
    description: "Everything connected to Insurvas in one place: apps that use an API key, webhooks that send policy and commission events out, your lead vendors and the browser extension.",
    short: "Who's connected, API keys, webhooks and the developer docs.",
    search_keywords: ["api", "api key", "api keys", "integration", "integrations", "webhook", "webhooks", "zapier", "make", "google sheets", "data warehouse", "developer", "developer docs", "token", "signing secret", "rotate key", "revoke key", "deliveries", "connected apps"],
  },
  { group: "Integrations", id: "sales-extension", label: "Browser extension", sort_order: 20, owned_by_module: "LA-3.12", required_feature: "applications", required_roles: OWNER, description: "The extension's install state, the carrier sites it may work on, and its recent access grants.", search_keywords: ["extension", "chrome"] },

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

  // ── Records ─────────────────────────────────────────────────────────────────────────────────────
  {
    group: "Records", id: "settings-history", label: "Settings history", sort_order: 10, owned_by_module: "LA-8.8", required_roles: OWNER,
    description: "Who changed which setting, from what to what, and when. Read only, and kept for good.",
    short: "Every settings change: who, what, from, to, when.",
    search_keywords: ["audit", "audit log", "history", "who changed", "settings changes", "change log"],
  },
];
