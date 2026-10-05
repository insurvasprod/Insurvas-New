// THE agent menu definition. This is the one data contract shared by the agent app and the
// admin plan preview. Plans grant feature keys; this file never branches on a plan code.
import type { TenantRole } from "@/lib/tenantAuth/roles";

export type MenuItem = {
  /** Stable namespaced key used by the menu contract, for example `leads.inbound`. */
  key: string;
  label: string;
  /** A shorter label for the sidebar rail, when the page title is too long for it. */
  navLabel?: string;
  /** The agent-plane URL. The current app keeps the `/app` namespace for local/public routes. */
  path: string;
  /** Icon name resolved by the shell; keeping the name here keeps the menu serialisable. */
  icon: string;
  /** Human-readable section carried on every node, as defined by the product contract. */
  section: string;
  /** Undefined means always visible, regardless of entitlement (Dashboard and Settings). */
  required_feature?: string;
  /** Optional tenant role gate; entitlement and role are independent dimensions. */
  required_roles?: readonly TenantRole[];
  /** Whether a real screen exists at this path today. */
  built?: boolean;
  /** One line on the coming-soon page saying what the screen will do. */
  blurb?: string;
  /**
   * For an unbuilt item: the built pages its coming-soon card offers "in the meantime", by key and
   * in order. Each is still dropped if this person's plan or role cannot open it. Unset means the
   * card picks pages from the same section.
   */
  meanwhile?: readonly string[];
};

export type MenuSection = {
  id: string;
  label: string;
  items: MenuItem[];
};

type MenuEntry = Omit<MenuItem, "section">;

function item(section: string, entry: MenuEntry): MenuItem {
  return { ...entry, section };
}

export const AGENT_MENU: MenuSection[] = [
  {
    id: "home",
    label: "Home",
    items: [item("Home", { key: "home.dashboard", label: "Dashboard", navLabel: "Home", path: "/app/dashboard", icon: "layout-dashboard", built: true })],
  },
  {
    id: "book",
    label: "Book of Business",
    items: [
      item("Book of Business", { key: "book.policies", label: "Policies", path: "/app/policies", icon: "book-open", built: true, required_feature: "book_of_business", required_roles: ["owner", "producer", "bookkeeper"], blurb: "The book you already have" }),
      item("Book of Business", { key: "book.statements", label: "Statements", path: "/app/statements", icon: "file-text", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Carrier statements imported, matched to policies by a person, and posted to the commission ledger." }),
      item("Book of Business", { key: "book.ledger", label: "Commission ledger", path: "/app/ledger", icon: "receipt", required_feature: "commission_ledger", required_roles: ["owner", "producer", "bookkeeper"], built: true }),
      // "Carrier appointments", not "Appointments". This is LA-0.5's vault — which carriers the
      // agent is appointed with, in which states, plus licences, E&O and CE. LA-2.11 books customer
      // appointments into a calendar, and the bare label sent anyone looking for that here. The
      // collision already cost something once: LA-2.8's first draft joined `public.appointments`
      // for its appointment tier and would have served leads on the strength of a licensing record.
      item("Book of Business", { key: "book.appointments", label: "Carrier appointments", path: "/app/appointments", icon: "calendar-days", required_feature: "appointment_vault", required_roles: ["owner", "producer"], built: true }),
      item("Book of Business", { key: "book.discrepancies", label: "Discrepancies", path: "/app/discrepancies", icon: "triangle-alert", required_feature: "discrepancy_report", required_roles: ["owner", "bookkeeper"], blurb: "What the carrier paid against what they owed.", built: true }),
    ],
  },
  {
    id: "leads",
    label: "Leads",
    items: [
      item("Leads", { key: "leads.workspace", label: "Lead workspace", path: "/app/leads", icon: "contact-round", built: true, required_feature: "book_of_business", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.floor", label: "Agent Floor", path: "/app/floor", icon: "radio-tower", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.inbound", label: "Inbound transfers", navLabel: "Inbound inbox", path: "/app/inbound", icon: "phone-incoming", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.partner-chat", label: "Partner chat", path: "/app/partner-chat", icon: "messages-square", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer"] }),
      item("Leads", { key: "leads.dialer", label: "Dialer", path: "/app/dialer", icon: "phone-outgoing", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "setter"] }),
      item("Leads", { key: "leads.import", label: "List import", path: "/app/import", icon: "list-plus", built: true, required_feature: "lead_import", required_roles: ["owner", "producer", "assistant"] }),
      // Directly after the import, because that is the order the work happens in: import a CSV, look
      // at what arrived, hand it out. The lead workspace is organised by pipeline and answers a
      // different question.
      item("Leads", { key: "leads.lists", label: "Lead lists", path: "/app/lead-lists", icon: "package", built: true, required_feature: "lead_import", required_roles: ["owner", "producer", "assistant"] }),
      // Owner and producer only. This screen shows what a list cost and what a usable lead cost,
      // which is money — the same boundary the campaigns and vendors routes enforce, and the reason
      // `assistant` is on List import above but not here.
      item("Leads", { key: "leads.campaigns", label: "Vendors & campaigns", path: "/app/campaigns", icon: "store", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"], blurb: "Who you buy from, what each batch cost, and what a dialable lead really costs." }),
      item("Leads", { key: "leads.nurture", label: "Lead recycling", path: "/app/nurture", icon: "rotate-ccw", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"] }),
      item("Leads", { key: "leads.assignments", label: "Lead assignment", path: "/app/assignments", icon: "route", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "assistant", "setter"] }),
      item("Leads", { key: "leads.duplicates", label: "Duplicate check", path: "/app/duplicates", icon: "copy-check", built: true, required_feature: "duplicate_detection", required_roles: ["owner", "producer", "assistant"] }),
    ],
  },
  {
    id: "sell",
    label: "Sell",
    items: [
      // LA-3 · the sale itself: interview → quote → application → submit → policy number.
      item("Sell", { key: "sell.applications", label: "Applications", path: "/app/applications", icon: "file-check", built: true, required_feature: "applications", required_roles: ["owner", "producer"], blurb: "Carrier applications, filled in-app." }),
      item("Sell", { key: "sell.pending", label: "Pending cases", path: "/app/pending", icon: "list-checks", built: true, required_feature: "applications", required_roles: ["owner", "producer"], blurb: "Everything between submitted and issued." }),
      item("Sell", { key: "sell.quoting", label: "Quotes", path: "/app/quoting", icon: "calculator", built: true, required_feature: "quoting", required_roles: ["owner", "producer"], blurb: "Compare carrier premiums side by side." }),
      item("Sell", { key: "sell.draft-dates", label: "Draft dates", path: "/app/draft-dates", icon: "calendar-clock", built: true, required_feature: "draft_date_optimizer", required_roles: ["owner", "producer"], blurb: "Pick the draft date least likely to bounce." }),
      item("Sell", { key: "sell.callbacks", label: "Callbacks", path: "/app/callbacks", icon: "calendar-check", required_feature: "callback_calendar", required_roles: ["owner", "producer", "assistant"], built: true }),
      // LA-2.11's day and week calendar, beside Callbacks because they are the two things on Ray's
      // diary. At `/app/calendar` specifically: `book_appointment` has always written its
      // notification with that link, and until now it was a 404.
      item("Sell", { key: "sell.calendar", label: "Calendar", path: "/app/calendar", icon: "calendar-clock", required_feature: "outbound_dialing", required_roles: ["owner", "producer", "setter"], built: true }),
      // p-app-setters: the licensed agent's day and the setters who book into it. Owners and producers
      // only — the people Settings › Calendar lists as bookable; setters book from the dialer.
      item("Sell", { key: "sell.setters", label: "Appointments & setters", path: "/app/setters", icon: "user-round-check", required_feature: "outbound_dialing", required_roles: ["owner", "producer"], built: true }),
      item("Sell", { key: "sell.deal-flow", label: "Daily deal flow", path: "/app/deal-flow", icon: "clipboard-list", required_feature: "daily_deal_flow", required_roles: ["owner", "producer"], built: true }),
    ],
  },
  {
    id: "retention",
    label: "Retention",
    items: [
      item("Retention", { key: "retention.lapse-risk", label: "Lapse risk", path: "/app/lapse-risk", icon: "radar", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer"] }),
      item("Retention", { key: "retention.payment-repair", label: "Payment repair", path: "/app/payment-repair", icon: "wrench", required_feature: "payment_repair", required_roles: ["owner", "producer"], blurb: "Fix a missed draft before it lapses." }),
      item("Retention", { key: "retention.winback", label: "Win-back", path: "/app/winback", icon: "rotate-ccw", required_feature: "winback", required_roles: ["owner", "producer"], blurb: "Bring back a lapsed customer." }),
    ],
  },
  {
    id: "insight",
    label: "Insight",
    items: [
      item("Insight", { key: "insight.true-cpa", label: "True CPA", path: "/app/true-cpa", icon: "chart-no-axes-combined", required_feature: "true_cpa", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "What your leads actually cost" }),
      item("Insight", { key: "insight.vendor-returns", label: "Vendor returns", path: "/app/vendor-returns", icon: "file-chart-column", required_feature: "true_cpa", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "Prepare evidence-backed claims and reconcile vendor credits." }),
      item("Insight", { key: "insight.sales-performance", label: "Sales performance", path: "/app/sales-performance", icon: "chart-no-axes-combined", built: true, required_feature: "sales_report", required_roles: ["owner", "producer", "bookkeeper"], blurb: "Funnel, timings and why carriers decline." }),
      item("Insight", { key: "insight.persistency", label: "Persistency", path: "/app/persistency", icon: "trending-up", required_feature: "cohort_persistency", required_roles: ["owner", "producer", "bookkeeper"], blurb: "Which lead source survives.", built: true }),
      item("Insight", { key: "insight.activity", label: "Activity & scorecard", path: "/app/activity", icon: "list-checks", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "setter"] }),
      item("Insight", { key: "insight.scoring", label: "Queue scoring", path: "/app/scoring", icon: "brain", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"], blurb: "The order leads are served in, and whether it beats the plain order." }),
    ],
  },
  {
    id: "partners",
    label: "Partners",
    items: [
      item("Partners", { key: "partners.publishers", label: "Partners", navLabel: "Publishers", path: "/app/publishers", icon: "users", required_feature: "publisher_records", required_roles: ["owner", "bookkeeper"], built: true }),
      item("Partners", { key: "partners.review", label: "Partner quality", path: "/app/partner-quality", icon: "chart-no-axes-combined", required_feature: "partner_quality", required_roles: ["owner", "producer", "bookkeeper"], built: true }),
      item("Partners", { key: "partners.payouts", label: "Payout runs", path: "/app/payouts", icon: "wallet-cards", required_feature: "payout_runs", required_roles: ["owner", "bookkeeper"], blurb: "Pay publishers from the ledger, not WhatsApp." }),
      item("Partners", { key: "partners.partner-portal", label: "Partner portal", path: "/app/partner-portal", icon: "external-link", required_feature: "partner_portal", required_roles: ["owner", "bookkeeper"], blurb: "Publishers see their own numbers." }),
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    items: [
      item("Accounting", { key: "accounting.pnl", label: "Profit & loss", path: "/app/pnl", icon: "landmark", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], blurb: "Did this month make money." }),
      item("Accounting", { key: "accounting.tax", label: "Tax summaries", path: "/app/tax", icon: "file-chart-column", required_feature: "tax_summaries", required_roles: ["owner", "bookkeeper"], blurb: "What the accountant asks for." }),
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      item("Compliance", { key: "compliance.tcpa", label: "TCPA / DNC", path: "/app/tcpa", icon: "shield-check", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer", "assistant", "setter"] }),
      item("Compliance", { key: "compliance.consent", label: "Consent locker", path: "/app/consent", icon: "lock-keyhole", built: true, required_feature: "consent_locker", required_roles: ["owner", "producer", "assistant"] }),
      item("Compliance", { key: "compliance.litigation", label: "Litigation packet", path: "/app/litigation", icon: "briefcase-business", required_feature: "litigation_packet", required_roles: ["owner"], blurb: "Everything about one number, for a lawyer." }),
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [item("Settings", { key: "settings.root", label: "Settings", path: "/app/settings", icon: "settings", built: true, required_roles: ["owner"] })],
  },
];

/** Filters the single menu definition to the features present in the cached entitlement. */
export function buildAgentMenu(grantedFeatureKeys: Iterable<string>, role: TenantRole = "owner"): MenuSection[] {
  const granted = new Set(grantedFeatureKeys);

  return AGENT_MENU.map((section) => ({
    ...section,
    items: section.items.filter((entry) =>
      (!entry.required_feature || granted.has(entry.required_feature)) &&
      (!entry.required_roles || entry.required_roles.includes(role)),
    ),
  })).filter((section) => section.items.length > 0);
}

export function menuFeatureKeys(): string[] {
  return AGENT_MENU.flatMap((section) => section.items.map((entry) => entry.required_feature).filter((key): key is string => Boolean(key)));
}

export function allMenuItems(): (MenuItem & { sectionId: string; sectionLabel: string })[] {
  return AGENT_MENU.flatMap((section) => section.items.map((entry) => ({ ...entry, sectionId: section.id, sectionLabel: section.label })));
}

/** The current filesystem uses the final URL segment as its route parameter. */
export function routeKey(item: Pick<MenuItem, "path">): string {
  return item.path.split("/").filter(Boolean).at(-1) ?? item.path;
}

/** Backward-compatible helper name for callers resolving the current route parameter. */
export function menuItemById(id: string): (MenuItem & { sectionLabel: string }) | null {
  return allMenuItems().find((entry) => entry.key === id || routeKey(entry) === id) ?? null;
}

export function menuItemForFeature(featureKey: string): (MenuItem & { sectionLabel: string }) | null {
  return allMenuItems().find((entry) => entry.required_feature === featureKey) ?? null;
}

/**
 * The eyebrow a page shows above its title.
 *
 * Derived rather than typed. Six screens had hand-written eyebrows that were the *filename index*
 * of their mockup in `docs/uiux-mockups/brex/` — "22 / Licensed agent", "25 / Analytics" — and a
 * customer had no idea what 22 counted. Thirty-two more were hand-written taxonomies that did not
 * agree with each other.
 *
 * This file already assigns every destination a section, so that is the answer. A page passes its
 * own path; anything not in the menu (auth, onboarding, checkout) has no section and says so by
 * returning null.
 */
export function sectionForPath(path: string): string | null {
  return allMenuItems().find((entry) => entry.path === path)?.section ?? null;
}

export function featureLabel(featureKey: string): string {
  const entry = menuItemForFeature(featureKey);
  if (entry) return entry.label;
  return featureKey.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

export function grantedAndBuilt(grantedFeatureKeys: Iterable<string>, role: TenantRole = "owner"): (MenuItem & { sectionLabel: string })[] {
  const granted = new Set(grantedFeatureKeys);
  return allMenuItems().filter((entry) => entry.built && (!entry.required_feature || granted.has(entry.required_feature)) && (!entry.required_roles || entry.required_roles.includes(role)));
}
