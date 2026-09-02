// THE agent menu definition. This is the one data contract shared by the agent app and the
// admin plan preview. Plans grant feature keys; this file never branches on a plan code.
import type { TenantRole } from "@/lib/tenantAuth/roles";

export type MenuItem = {
  /** Stable namespaced key used by the menu contract, for example `leads.inbound`. */
  key: string;
  label: string;
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
    items: [item("Home", { key: "home.dashboard", label: "Dashboard", path: "/app/dashboard", icon: "layout-dashboard", built: true })],
  },
  {
    id: "book",
    label: "Book of Business",
    items: [
      item("Book of Business", { key: "book.policies", label: "Policies", path: "/app/policies", icon: "book-open", built: true, required_feature: "book_of_business", required_roles: ["owner", "producer", "bookkeeper"] }),
      item("Book of Business", { key: "book.statements", label: "Statements", path: "/app/statements", icon: "file-text", required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"] }),
      item("Book of Business", { key: "book.ledger", label: "Commission ledger", path: "/app/ledger", icon: "receipt", required_feature: "commission_ledger", required_roles: ["owner", "producer", "bookkeeper"] }),
      item("Book of Business", { key: "book.appointments", label: "Appointments", path: "/app/appointments", icon: "calendar-days", required_feature: "appointment_vault", required_roles: ["owner", "producer"] }),
      item("Book of Business", { key: "book.discrepancies", label: "Discrepancies", path: "/app/discrepancies", icon: "triangle-alert", required_feature: "discrepancy_report", required_roles: ["owner", "bookkeeper"] }),
    ],
  },
  {
    id: "leads",
    label: "Leads",
    items: [
      item("Leads", { key: "leads.workspace", label: "Lead workspace", path: "/app/leads", icon: "contact-round", built: true, required_feature: "book_of_business", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.floor", label: "Agent Floor", path: "/app/floor", icon: "radio-tower", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.inbound", label: "Inbound transfers", path: "/app/inbound", icon: "phone-incoming", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.dialer", label: "Dialer", path: "/app/dialer", icon: "phone-outgoing", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"] }),
      item("Leads", { key: "leads.import", label: "List import", path: "/app/import", icon: "list-plus", required_feature: "lead_import", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.duplicates", label: "Duplicate check", path: "/app/duplicates", icon: "copy-check", built: true, required_feature: "duplicate_detection", required_roles: ["owner", "producer", "assistant"] }),
    ],
  },
  {
    id: "sell",
    label: "Sell",
    items: [
      item("Sell", { key: "sell.quoting", label: "Quoting", path: "/app/quoting", icon: "calculator", required_feature: "quoting", required_roles: ["owner", "producer"] }),
      item("Sell", { key: "sell.applications", label: "Applications", path: "/app/applications", icon: "file-check", required_feature: "applications", required_roles: ["owner", "producer"] }),
      item("Sell", { key: "sell.draft-dates", label: "Draft dates", path: "/app/draft-dates", icon: "calendar-clock", required_feature: "draft_date_optimizer", required_roles: ["owner", "producer"] }),
      item("Sell", { key: "sell.callbacks", label: "Callbacks", path: "/app/callbacks", icon: "calendar-check", required_feature: "callback_calendar", required_roles: ["owner", "producer", "assistant"] }),
      item("Sell", { key: "sell.deal-flow", label: "Daily deal flow", path: "/app/deal-flow", icon: "clipboard-list", required_feature: "daily_deal_flow", required_roles: ["owner", "producer"], built: true }),
    ],
  },
  {
    id: "retention",
    label: "Retention",
    items: [
      item("Retention", { key: "retention.lapse-risk", label: "Lapse risk", path: "/app/lapse-risk", icon: "radar", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer"] }),
      item("Retention", { key: "retention.payment-repair", label: "Payment repair", path: "/app/payment-repair", icon: "wrench", required_feature: "payment_repair", required_roles: ["owner", "producer"] }),
      item("Retention", { key: "retention.winback", label: "Win-back", path: "/app/winback", icon: "rotate-ccw", required_feature: "winback", required_roles: ["owner", "producer"] }),
    ],
  },
  {
    id: "insight",
    label: "Insight",
    items: [
      item("Insight", { key: "insight.true-cpa", label: "True CPA", path: "/app/true-cpa", icon: "chart-no-axes-combined", required_feature: "true_cpa", required_roles: ["owner", "producer", "bookkeeper"] }),
      item("Insight", { key: "insight.persistency", label: "Persistency", path: "/app/persistency", icon: "trending-up", required_feature: "cohort_persistency", required_roles: ["owner", "producer", "bookkeeper"] }),
      item("Insight", { key: "insight.partner-quality", label: "Partner quality", path: "/app/partner-quality", icon: "chart-no-axes-combined", required_feature: "partner_quality", required_roles: ["owner", "producer", "bookkeeper"], built: true }),
    ],
  },
  {
    id: "partners",
    label: "Partners",
    items: [
      item("Partners", { key: "partners.publishers", label: "Publishers", path: "/app/publishers", icon: "users", required_feature: "publisher_records", required_roles: ["owner", "bookkeeper"], built: true }),
      item("Partners", { key: "partners.payouts", label: "Payout runs", path: "/app/payouts", icon: "wallet-cards", required_feature: "payout_runs", required_roles: ["owner", "bookkeeper"] }),
      item("Partners", { key: "partners.partner-portal", label: "Partner portal", path: "/app/partner-portal", icon: "external-link", required_feature: "partner_portal", required_roles: ["owner", "bookkeeper"] }),
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    items: [
      item("Accounting", { key: "accounting.pnl", label: "Profit & loss", path: "/app/pnl", icon: "landmark", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"] }),
      item("Accounting", { key: "accounting.tax", label: "Tax summaries", path: "/app/tax", icon: "file-chart-column", required_feature: "tax_summaries", required_roles: ["owner", "bookkeeper"] }),
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      item("Compliance", { key: "compliance.tcpa", label: "TCPA / DNC", path: "/app/tcpa", icon: "shield-check", required_feature: "tcpa_checker", required_roles: ["owner", "producer", "assistant"] }),
      item("Compliance", { key: "compliance.consent", label: "Consent locker", path: "/app/consent", icon: "lock-keyhole", required_feature: "consent_locker", required_roles: ["owner", "producer", "assistant"] }),
      item("Compliance", { key: "compliance.litigation", label: "Litigation packet", path: "/app/litigation", icon: "briefcase-business", required_feature: "litigation_packet", required_roles: ["owner"] }),
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

export function featureLabel(featureKey: string): string {
  const entry = menuItemForFeature(featureKey);
  if (entry) return entry.label;
  return featureKey.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

export function grantedAndBuilt(grantedFeatureKeys: Iterable<string>, role: TenantRole = "owner"): (MenuItem & { sectionLabel: string })[] {
  const granted = new Set(grantedFeatureKeys);
  return allMenuItems().filter((entry) => entry.built && (!entry.required_feature || granted.has(entry.required_feature)) && (!entry.required_roles || entry.required_roles.includes(role)));
}
