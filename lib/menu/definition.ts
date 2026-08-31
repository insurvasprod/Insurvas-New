// THE agent menu definition. Deliberately data, not code branching — the Basic Idea doc's
// Appendix A names this as one of the two interfaces between the control plane and the tenant
// plane ("one menu definition as data", "required_feature on a menu node").
//
// This file is client-safe and has no `server-only` import, because BOTH of these render it:
//   - the admin feature picker's preview panel (SA-2.3)
//   - the agent app's real navigation, once entitlements exist (SA-2.8)
//
// That shared use is what makes "the preview matches what the agent actually sees" true by
// construction rather than by anyone remembering to update two lists.

export type MenuItem = {
  id: string;
  label: string;
  /** Undefined = always visible, regardless of plan (e.g. Dashboard, Settings). */
  requiredFeature?: string;
  /**
   * Whether a real screen exists at /app/<id> yet.
   *
   * Six of these thirty are built. Before this flag existed the other twenty-four rendered as
   * ordinary links straight into a 404 — a customer on a plan that grants them saw a full sidebar
   * where most of it was broken, which reads as a broken product rather than an unfinished one.
   *
   * Declared here as data rather than inferred from the filesystem, so that building a screen is
   * one edit in the same file that names it, and so the admin plan preview can say the same thing.
   */
  built?: boolean;
  /** One line on the coming-soon page saying what the screen will do. */
  blurb?: string;
};

export type MenuSection = {
  id: string;
  label: string;
  items: MenuItem[];
};

export const AGENT_MENU: MenuSection[] = [
  {
    id: "home",
    label: "Home",
    items: [{ id: "dashboard", label: "Dashboard", built: true }],
  },
  {
    id: "book",
    label: "Book of Business",
    items: [
      { id: "policies", label: "Policies", built: true, requiredFeature: "book_of_business" },
      { id: "statements", label: "Statements", requiredFeature: "statement_ingestion" },
      { id: "ledger", label: "Commission ledger", requiredFeature: "commission_ledger" },
      { id: "appointments", label: "Appointments", requiredFeature: "appointment_vault" },
      { id: "discrepancies", label: "Discrepancies", requiredFeature: "discrepancy_report" },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    items: [
      { id: "leads", label: "Lead workspace", built: true, requiredFeature: "book_of_business" },
      { id: "inbound", label: "Inbound transfers", requiredFeature: "inbound_transfers" },
      { id: "dialer", label: "Dialer", built: true, requiredFeature: "outbound_dialing" },
      { id: "import", label: "List import", requiredFeature: "lead_import" },
      { id: "duplicates", label: "Duplicate check", requiredFeature: "duplicate_detection" },
    ],
  },
  {
    id: "sell",
    label: "Sell",
    items: [
      { id: "quoting", label: "Quoting", requiredFeature: "quoting" },
      { id: "applications", label: "Applications", requiredFeature: "applications" },
      { id: "draft-dates", label: "Draft dates", requiredFeature: "draft_date_optimizer" },
      { id: "callbacks", label: "Callbacks", requiredFeature: "callback_calendar" },
      { id: "deal-flow", label: "Daily deal flow", requiredFeature: "daily_deal_flow" },
    ],
  },
  {
    id: "retention",
    label: "Retention",
    items: [
      { id: "lapse-risk", label: "Lapse risk", built: true, requiredFeature: "chargeback_radar" },
      { id: "payment-repair", label: "Payment repair", requiredFeature: "payment_repair" },
      { id: "winback", label: "Win-back", requiredFeature: "winback" },
    ],
  },
  {
    id: "insight",
    label: "Insight",
    items: [
      { id: "true-cpa", label: "True CPA", requiredFeature: "true_cpa" },
      { id: "persistency", label: "Persistency", requiredFeature: "cohort_persistency" },
    ],
  },
  {
    id: "partners",
    label: "Partners",
    items: [
      { id: "publishers", label: "Publishers", requiredFeature: "publisher_records" },
      { id: "payouts", label: "Payout runs", requiredFeature: "payout_runs" },
      { id: "partner-portal", label: "Partner portal", requiredFeature: "partner_portal" },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    items: [
      { id: "pnl", label: "Profit & loss", requiredFeature: "profit_and_loss" },
      { id: "tax", label: "Tax summaries", requiredFeature: "tax_summaries" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      { id: "tcpa", label: "TCPA / DNC", requiredFeature: "tcpa_checker" },
      { id: "consent", label: "Consent locker", requiredFeature: "consent_locker" },
      { id: "litigation", label: "Litigation packet", requiredFeature: "litigation_packet" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [{ id: "settings", label: "Settings", built: true }],
  },
];

/**
 * Filters the menu to what a given set of granted feature keys actually exposes.
 *
 * A section disappears entirely when none of its items are visible — an empty "Retention"
 * heading would be worse than no heading at all.
 */
export function buildAgentMenu(grantedFeatureKeys: Iterable<string>): MenuSection[] {
  const granted = new Set(grantedFeatureKeys);

  return AGENT_MENU.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.requiredFeature || granted.has(item.requiredFeature)),
  })).filter((section) => section.items.length > 0);
}

/** Every feature key referenced by a menu node — used by the catalog/menu drift check. */
export function menuFeatureKeys(): string[] {
  return AGENT_MENU.flatMap((s) => s.items.map((i) => i.requiredFeature).filter((k): k is string => Boolean(k)));
}

/** Every menu item, flattened, with the section it belongs to. */
export function allMenuItems(): (MenuItem & { sectionId: string; sectionLabel: string })[] {
  return AGENT_MENU.flatMap((section) =>
    section.items.map((item) => ({ ...item, sectionId: section.id, sectionLabel: section.label })),
  );
}

export function menuItemById(id: string): (MenuItem & { sectionLabel: string }) | null {
  return allMenuItems().find((item) => item.id === id) ?? null;
}

export function menuItemForFeature(featureKey: string): (MenuItem & { sectionLabel: string }) | null {
  return allMenuItems().find((item) => item.requiredFeature === featureKey) ?? null;
}

/**
 * A human name for a feature key.
 *
 * The entitlement blob carries keys and nothing else — deliberately, since it is a contract rather
 * than a presentation layer. That left the agent's own dashboard listing `book_of_business` and
 * `chargeback_radar` back at them, which is our internal vocabulary on a customer's screen.
 *
 * The menu is the right place to resolve it: it already pairs every feature key with the words we
 * chose to describe it, and it is already shared with the admin plan preview, so the name a
 * customer sees and the name an operator sees cannot drift apart.
 */
export function featureLabel(featureKey: string): string {
  const item = menuItemForFeature(featureKey);
  if (item) return item.label;
  // A feature with no menu node is real — several are backend-only. Better a tidied key than a raw
  // one, and better a raw one than pretending the feature does not exist.
  return featureKey.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Feature keys the plan grants that lead to a screen a customer can actually open today. */
export function grantedAndBuilt(grantedFeatureKeys: Iterable<string>): (MenuItem & { sectionLabel: string })[] {
  const granted = new Set(grantedFeatureKeys);
  return allMenuItems().filter((item) => item.built && (!item.requiredFeature || granted.has(item.requiredFeature)));
}
