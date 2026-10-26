// THE agent menu definition. This is the one data contract shared by the agent app and the
// admin plan preview. Plans grant feature keys; this file never branches on a plan code.
import { baseRoleOf, isAgencyTitle, type MemberRole } from "../tenantAuth/roles.ts";
import { UNHIDEABLE_PAGES } from "../tenantAuth/teamAccess.ts";

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
  /**
   * Optional tenant role gate; entitlement and role are independent dimensions. AG-0.2: may name an agency
   * title (admin, manager); a title also opens what its base role opens (menuRoleAdmits).
   */
  required_roles?: readonly MemberRole[];
  /** Whether a real screen exists at this path today. */
  built?: boolean;
  /** False for a settings page reached from Settings, never listed in the rail itself. */
  sidebar?: false;
  /**
   * Listed in the rail only when the item with this key is not (2026-10-26 merges): Vendors &
   * campaigns is a tab of Lead sources, so it is listed on its own only for someone who can open the
   * tab but not the page's main item (a plan with the dialer and no list import).
   */
  sidebar_fallback_for?: string;
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

// Grouped by the job a person is doing (2026-10-13, One-Path Plan Phase 2, owner decision:
// "regroup by job"), and split again 2026-10-15 (owner decision after the LA-8 walk: no dropdown so
// long it overwhelms): Money became Commissions and Accounting, Setup became Compliance (carrier
// appointments joined the Book), and the reports left the job groups for a Reports group of their own.
// No group holds more than eight. Keys, paths, gates and roles are unchanged; only `section` moved.
// Accounting settings and Carrier rules are settings: they open from Settings, not the rail
// (`sidebar: false`), and stay here so search, page titles and the plan preview still know them.
export const AGENT_MENU: MenuSection[] = [
  {
    id: "home",
    label: "Home",
    items: [
      item("Home", { key: "home.dashboard", label: "Dashboard", navLabel: "Home", path: "/app/dashboard", icon: "layout-dashboard", built: true }),
      // AG-0.11 · the agency owner's home: which producers are making the agency money. A manager sees it scoped to
      // his reports; a producer never sees it.
      item("Home", { key: "home.agency", label: "Agency dashboard", navLabel: "Agency", path: "/app/agency", icon: "layout-dashboard", required_feature: "agency_dashboard", required_roles: ["owner", "bookkeeper", "manager"], built: true, blurb: "Which of your producers is actually making you money." }),
    ],
  },
  {
    id: "today",
    label: "Today",
    items: [
      // One Transfers entry (2026-10-25): the floor is its second view, reached from the switch on the
      // page, so it leaves the rail but keeps its path, gate and title for links and search.
      item("Today", { key: "leads.floor", label: "Inbound floor", path: "/app/floor", icon: "radio-tower", built: true, sidebar: false, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Today", { key: "leads.inbound", label: "Inbound", navLabel: "Inbound", path: "/app/inbound", icon: "inbox", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Today", { key: "leads.dialer", label: "Dialer", path: "/app/dialer", icon: "phone-call", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "setter"] }),
      item("Today", { key: "sell.callbacks", label: "Callbacks", path: "/app/callbacks", icon: "calendar-check", required_feature: "callback_calendar", required_roles: ["owner", "producer", "assistant"], built: true }),
      // LA-2.11's day and week calendar, beside Callbacks because they are the two things on Ray's
      // diary. At `/app/calendar` specifically: `book_appointment` has always written its
      // notification with that link, and until now it was a 404.
      item("Today", { key: "sell.calendar", label: "Calendar", path: "/app/calendar", icon: "calendar-days", required_feature: "outbound_dialing", required_roles: ["owner", "producer", "assistant", "setter"], built: true }),
      // p-app-setters: the licensed agent's day and the setters who book into it. Owners and producers
      // only — the people Settings › Calendar lists as bookable; setters book from the dialer.
      item("Today", { key: "sell.setters", label: "Appointments & setters", path: "/app/setters", icon: "headset", required_feature: "outbound_dialing", required_roles: ["owner", "producer"], built: true }),
    ],
  },
  {
    id: "leads",
    label: "Leads",
    items: [
      item("Leads", { key: "leads.workspace", label: "Lead workspace", path: "/app/leads", icon: "square-kanban", built: true, required_feature: "book_of_business", required_roles: ["owner", "producer", "assistant"] }),
      // 2026-10-26: import is a side sheet on Lead sources ("Import a list"); /app/import opens it there.
      item("Leads", { key: "leads.import", label: "List import", path: "/app/import", icon: "list-plus", built: true, sidebar: false, required_feature: "lead_import", required_roles: ["owner", "producer", "assistant"] }),
      // Directly after the import, because that is the order the work happens in: import a CSV, look
      // at what arrived, hand it out. The lead workspace is organised by pipeline and answers a
      // different question.
      // 2026-10-26 (owner pick, split by job): Lead lists, Vendors & campaigns and List import are one
      // page, Lead sources. The key stays `leads.lists` — team access and saved hidden pages name it.
      item("Leads", { key: "leads.lists", label: "Lead sources", path: "/app/lead-sources", icon: "package", built: true, required_feature: "lead_import", required_roles: ["owner", "producer", "assistant"] }),
      item("Leads", { key: "leads.assignments", label: "Lead routing", path: "/app/assignments", icon: "route", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "assistant", "setter"] }),
      item("Leads", { key: "leads.nurture", label: "Lead recycling", path: "/app/nurture", icon: "recycle", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"] }),
      item("Leads", { key: "leads.duplicates", label: "Duplicate check", path: "/app/duplicates", icon: "copy-check", built: true, required_feature: "duplicate_detection", required_roles: ["owner", "producer", "assistant"] }),
      // Owner and producer only. This screen shows what a list cost and what a usable lead cost,
      // which is money — the same boundary the campaigns and vendors routes enforce, and the reason
      // `assistant` is on List import above but not here.
      item("Leads", { key: "leads.campaigns", label: "Vendors & campaigns", path: "/app/campaigns", icon: "store", built: true, sidebar_fallback_for: "leads.lists", required_feature: "outbound_dialing", required_roles: ["owner", "producer"], blurb: "Who you buy from, what each batch cost, and what a dialable lead really costs." }),
    ],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      // LA-3 · the sale itself: interview → quote → application → submit → policy number.
      item("Sales", { key: "sell.applications", label: "Applications", path: "/app/applications", icon: "file-pen-line", built: true, required_feature: "applications", required_roles: ["owner", "producer"], blurb: "Carrier applications, filled in-app." }),
      item("Sales", { key: "sell.pending", sidebar_fallback_for: "sell.applications", label: "Pending cases", path: "/app/pending", icon: "hourglass", built: true, required_feature: "applications", required_roles: ["owner", "producer"], blurb: "Everything between submitted and issued." }),
      item("Sales", { key: "sell.quoting", sidebar_fallback_for: "sell.applications", label: "Quotes", path: "/app/quoting", icon: "calculator", built: true, required_feature: "quoting", required_roles: ["owner", "producer"], blurb: "Compare carrier premiums side by side." }),
      item("Sales", { key: "sell.draft-dates", sidebar_fallback_for: "sell.applications", label: "Draft dates", path: "/app/draft-dates", icon: "calendar-clock", built: true, required_feature: "draft_date_optimizer", required_roles: ["owner", "producer"], blurb: "Pick the draft date least likely to bounce." }),
      item("Sales", { key: "sell.deal-flow", label: "Daily deal flow", path: "/app/deal-flow", icon: "clipboard-list", required_feature: "daily_deal_flow", required_roles: ["owner", "producer"], built: true }),
    ],
  },
  {
    id: "book",
    label: "Book",
    items: [
      item("Book", { key: "book.policies", label: "Policies", path: "/app/policies", icon: "book-user", built: true, required_feature: "book_of_business", required_roles: ["owner", "producer", "bookkeeper"], blurb: "The book you already have" }),
      item("Book", { key: "retention.lapse-risk", label: "Lapse risk", path: "/app/lapse-risk", icon: "radar", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer", "retention"] }),
      // LA-5.3 · predicted, not observed: kept apart from Lapse risk so a guess never sits beside an emergency.
      item("Book", { key: "retention.save-queue", label: "Save queue", path: "/app/save-queue", icon: "shield-check", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer", "retention"], blurb: "Policies paying fine today that the radar says will stop, and the fix." }),
      // LA-5.4 · servicing requests (the `payment_repair` feature): asked of the carrier, proven by the next file.
      item("Book", { key: "retention.payment-repair", label: "Servicing", path: "/app/servicing", icon: "wrench", built: true, required_feature: "payment_repair", required_roles: ["owner", "producer", "retention"], blurb: "Payment date, bank, bill-to-draft and address changes, verified by the next carrier file." }),
      // LA-5.6 · reinstatement (the `winback` feature): a lapsed policy brought back before the carrier's window shuts.
      item("Book", { key: "retention.winback", label: "Reinstatement", path: "/app/reinstatement", icon: "heart-handshake", built: true, required_feature: "winback", required_roles: ["owner", "producer", "retention"], blurb: "Lapsed policies the carrier will still take back, with the days left." }),
      // LA-5.8 · what each person working retention achieved, save rate always by reason. A rep sees their own.
      item("Book", { key: "retention.scorecard", label: "Retention scorecard", path: "/app/retention-scorecard", icon: "chart-no-axes-combined", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer", "retention"], blurb: "Policies worked, contact rate and save rate by reason, per person." }),
      // LA-5.9 · whether the radar's bands separate, and whether working the queue beats the holdout.
      item("Book", { key: "retention.results", label: "Does it work?", path: "/app/retention-results", icon: "chart-line", built: true, required_feature: "chargeback_radar", required_roles: ["owner"], blurb: "Whether the risk bands came true, and what working the queue saved, from your own book." }),
      // "Carrier appointments", not "Appointments". This is LA-0.5's vault — which carriers the
      // agent is appointed with, in which states, plus licences. LA-2.11 books customer
      // appointments into a calendar, and the bare label sent anyone looking for that here. The
      // collision already cost something once: LA-2.8's first draft joined `public.appointments`
      // for its appointment tier and would have served leads on the strength of a licensing record.
      item("Book", { key: "book.appointments", label: "Carrier appointments", path: "/app/appointments", icon: "badge-check", required_feature: "appointment_vault", required_roles: ["owner", "producer"], built: true }),
    ],
  },
  // Agency Module 0 (AG-1) · the Team group exists only on an agency plan: every node needs an agency feature.
  {
    id: "team",
    label: "Team",
    items: [
      item("Team", { key: "team.producers", label: "Producers", path: "/app/producers", icon: "user-round-check", required_feature: "team_hierarchy", required_roles: ["owner", "bookkeeper", "producer"], built: true, blurb: "Everyone who writes business under your contracts." }),
      item("Team", { key: "team.hierarchy", label: "Hierarchy & Overrides", navLabel: "Hierarchy", path: "/app/hierarchy", icon: "trending-up", required_feature: "team_hierarchy", required_roles: ["owner", "bookkeeper", "manager"], built: true, blurb: "Who reports to whom, and what the agency keeps on each producer." }),
      item("Team", { key: "team.routing", label: "Lead routing", path: "/app/lead-routing", icon: "route", sidebar_fallback_for: "leads.assignments", required_feature: "lead_assignment", required_roles: ["owner"], built: true, blurb: "Give every lead to a producer who can write it, before it goes cold." }),
      item("Team", { key: "team.splits", label: "Commission splits", path: "/app/commission-splits", icon: "hand-coins", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Policies two producers share, split after the override." }),
      item("Team", { key: "team.payouts", label: "Payout runs", navLabel: "Producer payouts", path: "/app/producer-payouts", icon: "wallet-cards", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Close a period and pay your producers, with a statement each." }),
      item("Team", { key: "team.scorecards", label: "Producer scorecards", navLabel: "Scorecards", path: "/app/producer-scorecards", icon: "gauge", required_feature: "producer_scorecards", required_roles: ["owner", "bookkeeper", "producer"], built: true, blurb: "Who is profitable, not just busy." }),
      item("Team", { key: "team.review", label: "Application review", path: "/app/application-review", icon: "file-check", required_feature: "team_qa", required_roles: ["owner", "producer"], built: true, blurb: "Sampled applications checked against the submission checks." }),
    ],
  },
  {
    id: "commissions",
    label: "Commissions",
    items: [
      item("Commissions", { key: "book.ledger", label: "Commission ledger", path: "/app/ledger", icon: "receipt", required_feature: "commission_ledger", required_roles: ["owner", "producer", "bookkeeper"], built: true }),
      item("Commissions", { key: "book.statements", label: "Statements", path: "/app/statements", icon: "file-text", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Carrier statements imported, matched to policies by a person, and posted to the commission ledger." }),
      item("Commissions", { key: "book.discrepancies", label: "Discrepancies", path: "/app/discrepancies", icon: "scale", required_feature: "discrepancy_report", required_roles: ["owner", "bookkeeper"], blurb: "What the carrier paid against what they owed.", built: true }),
      // AG-1.4 / AG-1.12 · statement rows no producer could be given safely, and each producer's three truths.
      item("Commissions", { key: "commissions.attribution", label: "Attribution queue", path: "/app/attribution", icon: "scale", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Statement rows we could not safely give to one producer." }),
      item("Commissions", { key: "commissions.producer_reconciliation", label: "Producer reconciliation", navLabel: "Reconciliation", path: "/app/producer-reconciliation", icon: "badge-dollar-sign", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Expected, reported and received, per producer, never blended." }),
      // AG-1.5 / AG-1.8 · a producer's own pay: his ledger and his statements, opened without asking anyone.
      item("Commissions", { key: "commissions.my_pay", label: "My pay", path: "/app/my-pay", icon: "briefcase-business", required_feature: "producer_payouts", required_roles: ["producer"], built: true, blurb: "What you earned, what came back, and every statement." }),
      item("Commissions", { key: "book.rate_card", label: "Rate card", path: "/app/rate-card", icon: "calculator", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Your contract level and commission rates per carrier, and how much of your book they can check." }),
    ],
  },
  {
    id: "data",
    label: "Data in",
    items: [
      item("Data in", { key: "book.carrier_files", label: "Carrier files", path: "/app/carrier-files", icon: "files", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Every policy and commission file a carrier sent, however it arrived: uploaded, emailed in or dropped by a script." }),
      item("Data in", { key: "book.import", label: "Import your book", path: "/app/book-import", icon: "import", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Your latest policy file from each carrier portal: your book, on day one." }),
      item("Data in", { key: "book.policy_matching", label: "Policy matching", path: "/app/policy-matching", icon: "link", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Which client and agent each carrier policy belongs to, and the ones waiting for a person to decide." }),
      item("Data in", { key: "book.exceptions", label: "Exceptions", path: "/app/exceptions", icon: "circle-alert", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "producer", "bookkeeper"], blurb: "Policies with no sale, sales with no policy, and clients who may be one person — each with an owner and an age." }),
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    items: [
      // LA-7.2 · lead invoices: what the agency paid for leads, per campaign.
      // 2026-10-26: Lead invoices and Vendor returns are one page, Vendor bills (key kept, as above).
      item("Accounting", { key: "accounting.invoices", label: "Vendor bills", path: "/app/vendor-bills", icon: "file-check", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What you paid for leads, and whether it matches what arrived." }),
      item("Accounting", { key: "insight.vendor-returns", label: "Vendor returns", path: "/app/vendor-returns", icon: "undo", sidebar_fallback_for: "accounting.invoices", required_feature: "true_cpa", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "Prepare evidence-backed claims and reconcile vendor credits." }),
      // LA-7.3 · expenses: tools, insurance, fees — acquisition or overhead.
      item("Accounting", { key: "accounting.expenses", label: "Expenses", path: "/app/expenses", icon: "hand-coins", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Everything you spend that is not a lead." }),
      // LA-7.5 · producer splits: the agency's side, and each producer's own balance.
      item("Accounting", { key: "accounting.producer_splits", label: "Producer splits", path: "/app/producer-splits", icon: "trending-up", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What each producer is owed, and what they owe back." }),
      item("Accounting", { key: "accounting.my_balance", label: "My balance", path: "/app/my-balance", icon: "briefcase-business", required_feature: "profit_and_loss", required_roles: ["producer"], built: true, blurb: "Your share of the commission, and what has come back." }),
      // LA-7.6 · bank deposits: the third truth about money — what actually arrived.
      item("Accounting", { key: "accounting.bank", label: "Bank deposits", path: "/app/bank", icon: "folder-input", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What actually landed in the bank, matched to what carriers said they paid." }),
      item("Accounting", { key: "accounting.pnl", label: "Profit & loss", path: "/app/pnl", icon: "chart-line", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Did this month make money." }),
      item("Accounting", { key: "accounting.tax", label: "Tax summaries", path: "/app/tax", icon: "file-chart-column", required_feature: "tax_summaries", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What the accountant asks for." }),
    ],
  },
  {
    id: "partners",
    label: "Partners",
    items: [
      item("Partners", { key: "partners.publishers", label: "Partners", navLabel: "Publishers", path: "/app/publishers", icon: "handshake", required_feature: "publisher_records", required_roles: ["owner", "bookkeeper"], built: true }),
      item("Partners", { key: "leads.partner-chat", label: "Partner chat", path: "/app/partner-chat", icon: "messages-square", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer"] }),
      item("Partners", { key: "partners.payouts", label: "Payout runs", path: "/app/payouts", icon: "wallet-cards", required_feature: "payout_runs", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Pay publishers from the ledger, not WhatsApp." }),
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      item("Compliance", { key: "compliance.dashboard", label: "Compliance", navLabel: "Overview", path: "/app/compliance", icon: "scale", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer"], blurb: "Am I exposed right now: deadlines, gaps and coverage on one screen." }),
      item("Compliance", { key: "compliance.tcpa", label: "TCPA / DNC", path: "/app/tcpa", icon: "phone-off", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer", "assistant", "setter"] }),
      item("Compliance", { key: "compliance.consent", label: "Consent locker", path: "/app/consent", icon: "lock-keyhole", built: true, required_feature: "consent_locker", required_roles: ["owner", "producer", "assistant"] }),
      item("Compliance", { key: "compliance.complaints", label: "Complaints", path: "/app/complaints", icon: "circle-alert", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer"], blurb: "Every complaint with an owner, a deadline and a countdown." }),
      item("Compliance", { key: "compliance.deletions", label: "Deletion requests", path: "/app/deletion-requests", icon: "shield-check", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer"], blurb: "One person asks to be deleted: verify, hold, delete, certify." }),
      item("Compliance", { key: "compliance.litigation", label: "Evidence report", path: "/app/evidence-report", icon: "gavel", built: true, required_feature: "litigation_packet", required_roles: ["owner", "producer"], blurb: "Everything we hold about one number, and every gap." }),
    ],
  },
  {
    id: "reports",
    label: "Reports",
    items: [
      item("Reports", { key: "insight.sales-performance", label: "Sales performance", path: "/app/sales-performance", icon: "chart-column", built: true, required_feature: "sales_report", required_roles: ["owner", "producer", "bookkeeper"], blurb: "Funnel, timings and why carriers decline." }),
      item("Reports", { key: "insight.activity", label: "Team activity", path: "/app/activity", icon: "activity", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "setter"] }),
      item("Reports", { key: "insight.scoring", label: "Queue scoring", path: "/app/scoring", icon: "brain", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"], blurb: "The order leads are served in, and whether it beats the plain order." }),
      item("Reports", { key: "insight.book-scorecards", label: "Book scorecards", path: "/app/book-scorecards", icon: "gauge", required_feature: "cohort_persistency", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "Persistency, placement, chargebacks and true cost per sale, from your carrier files." }),
      item("Reports", { key: "insight.true-cpa", label: "True CPA", path: "/app/true-cpa", icon: "badge-dollar-sign", required_feature: "true_cpa", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "What your leads actually cost" }),
      item("Reports", { key: "partners.review", label: "Partner quality", path: "/app/partner-quality", icon: "gauge", required_feature: "partner_quality", required_roles: ["owner", "producer", "bookkeeper"], built: true }),
    ],
  },
  {
    id: "settings-pages",
    label: "Settings",
    items: [
      // LA-7.9 · accounting settings: reporting basis, acquisition vs overhead, payouts, splits, bank matching, tax.
      item("Settings", { key: "accounting.settings", label: "Accounting settings", path: "/app/accounting-settings", icon: "list-checks", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, sidebar: false, blurb: "Thresholds, categories, periods and split rules." }),
      // LA-5.11 · everything LA-5 reads: weights, thresholds, queue, signals, campaigns, reinstatement, win-back, holdout, assignment.
      item("Settings", { key: "retention.settings", label: "Retention settings", path: "/app/retention-settings", icon: "list-checks", required_feature: "chargeback_radar", required_roles: ["owner"], built: true, sidebar: false, blurb: "Weights, thresholds, cooling-off periods and the holdout." }),
      item("Settings", { key: "book.carrier_rules", label: "Carrier rules", path: "/app/carrier-rules", icon: "scroll-text", built: true, sidebar: false, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Each carrier's save windows, grace, triggers and payout rules, and what is still missing." }),
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      // LA-8.1: open to every role. Each section inside gates itself (lib/settings/sections.ts), so a
      // producer finds their profile and notifications there and nothing they may not open.
      item("Settings", { key: "settings.root", label: "Settings", path: "/app/settings", icon: "settings", built: true }),
    ],
  },
];

/** Filters the single menu definition to the features present in the cached entitlement. */
/**
 * AG-0.2 · whether a menu gate admits a member. A title opens what its base role opens (an admin what an owner
 * does, a manager what a producer does); an item may also name a title alone, so the agency dashboard can be a
 * manager's without being every producer's.
 */
export function menuRoleAdmits(required: readonly MemberRole[] | undefined, role: MemberRole): boolean {
  if (!required) return true;
  if (required.includes(role)) return true;
  return isAgencyTitle(role) && required.includes(baseRoleOf(role));
}

/**
 * AG-0.5 · inside an agency these screens are the agency's business, not a producer's work: their APIs refuse a
 * narrowed session (producer, manager, assistant, setter — lib/agency/routeScope.ts), so the menu does not offer
 * them. A solo agent and the all-seeing roles keep every item.
 */
export const AGENCY_OWNER_ONLY_KEYS: ReadonlySet<string> = new Set([
  "leads.import", "leads.lists", "leads.nurture", "leads.duplicates", "leads.campaigns",
  "book.exceptions", "insight.vendor-returns", "insight.scoring", "insight.true-cpa", "partners.review",
  "compliance.dashboard", "compliance.tcpa", "compliance.consent", "compliance.complaints", "compliance.deletions", "compliance.litigation",
]);

/**
 * Custom team access: `extraRoles` are the member's other roles (the union opens an item), `hiddenPages` the menu
 * keys the owner hid for them (removed whatever their roles allow; Settings is never hidden).
 */
export function buildAgentMenu(
  grantedFeatureKeys: Iterable<string>,
  role: MemberRole = "owner",
  options: { agencyNarrow?: boolean; extraRoles?: readonly MemberRole[]; hiddenPages?: readonly string[] } = {},
): MenuSection[] {
  const granted = new Set(grantedFeatureKeys);
  const roles = [role, ...(options.extraRoles ?? [])];
  const hidden = new Set((options.hiddenPages ?? []).filter((key) => !UNHIDEABLE_PAGES.has(key)));

  return AGENT_MENU.map((section) => ({
    ...section,
    items: section.items.filter((entry) =>
      (!entry.required_feature || granted.has(entry.required_feature)) &&
      roles.some((held) => menuRoleAdmits(entry.required_roles, held)) &&
      !(options.agencyNarrow && AGENCY_OWNER_ONLY_KEYS.has(entry.key)) &&
      !hidden.has(entry.key),
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

export function grantedAndBuilt(grantedFeatureKeys: Iterable<string>, role: MemberRole = "owner"): (MenuItem & { sectionLabel: string })[] {
  const granted = new Set(grantedFeatureKeys);
  return allMenuItems().filter((entry) => entry.built && (!entry.required_feature || granted.has(entry.required_feature)) && menuRoleAdmits(entry.required_roles, role));
}
