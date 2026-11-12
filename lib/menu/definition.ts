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
  /**
   * The whole group is this one page (2026-10-30, Compliance in one page): when it is the group's only item
   * in the rail, the group is drawn as one link, named and iconned as the group, not a dropdown with one row.
   */
  groupLink?: boolean;
  /** One line on the coming-soon page saying what the screen will do. */
  blurb?: string;
  /**
   * For an unbuilt item: the built pages its coming-soon card offers "in the meantime", by key and
   * in order. Each is still dropped if this person's plan or role cannot open it. Unset means the
   * card picks pages from the same section.
   */
  meanwhile?: readonly string[];
  /**
   * Solo mode (owner 2026-10-29): a page that only makes sense with other callers on the workspace —
   * routing leads to them, their bookings, who is on the floor. Left out, not greyed, for an individual
   * agent working alone (lib/tenantTeam/solo.ts); it comes back the moment a setter or agent joins.
   */
  teamOnly?: boolean;
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
      // his reports; a producer never sees it. Its own icon (owner 2026-11-03): the agency's building, not Home's grid.
      item("Home", { key: "home.agency", label: "Agency dashboard", navLabel: "Agency", path: "/app/agency", icon: "building", required_feature: "agency_dashboard", required_roles: ["owner", "bookkeeper", "manager"], built: true, blurb: "Which of your producers is actually making you money." }),
      // AG-1.1 · Producers, the second step of Home › Agency (from Team, owner 2026-11-03): the Agency link stands for
      // it; without the dashboard it is Home's own link. A producer opens their record from Settings › My profile.
      item("Home", { key: "team.producers", sidebar_fallback_for: "home.agency", label: "Producers", path: "/app/producers", icon: "user-round-check", required_feature: "team_hierarchy", required_roles: ["owner", "bookkeeper", "manager"], built: true, blurb: "Everyone who writes business under your contracts." }),
    ],
  },
  {
    id: "today",
    label: "Today",
    items: [
      // Inbound A (2026-10-27): the Agent Floor is Inbound's Team view, reached from the Team button
      // on Inbound. It stays off the rail but keeps its key, gate and a title for links and search.
      // /app/floor forwards here.
      item("Today", { key: "leads.floor", label: "Inbound team", path: "/app/inbound/team", icon: "radio-tower", built: true, sidebar: false, teamOnly: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Today", { key: "leads.inbound", label: "Inbound", navLabel: "Inbound", path: "/app/inbound", icon: "inbox", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer", "assistant"] }),
      item("Today", { key: "leads.dialer", label: "Dialer", path: "/app/dialer", icon: "phone-call", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "setter"] }),
      item("Today", { key: "sell.callbacks", label: "Callbacks", path: "/app/callbacks", icon: "calendar-check", required_feature: "callback_calendar", required_roles: ["owner", "producer", "assistant"], built: true }),
      // LA-2.11's day and week calendar, beside Callbacks because they are the two things on Ray's
      // diary. At `/app/calendar` specifically: `book_appointment` has always written its
      // notification with that link, and until now it was a 404.
      item("Today", { key: "sell.calendar", label: "Calendar", path: "/app/calendar", icon: "calendar-days", required_feature: "outbound_dialing", required_roles: ["owner", "producer", "assistant", "setter"], built: true }),
      // p-app-setters: the licensed agent's day and the setters who book into it. Owners and producers
      // only — the people Settings › Calendar lists as bookable; setters book from the dialer.
      item("Today", { key: "sell.setters", label: "Appointments & setters", path: "/app/setters", icon: "headset", teamOnly: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"], built: true }),
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
      item("Leads", { key: "leads.lists", label: "Lead flow", path: "/app/lead-sources", icon: "package", built: true, required_feature: "lead_import", required_roles: ["owner", "producer", "assistant"] }),
      // 2026-10-28 (owner pick B, "Leads in"): routing, recycling and the duplicate check are steps of
      // Lead sources, on its rail. They keep their keys, gates and addresses; the sidebar shows them only
      // to someone who cannot open Lead sources (a setter routes; a plan without import still recycles).
      item("Leads", { key: "leads.assignments", label: "Lead routing", path: "/app/assignments", icon: "route", built: true, teamOnly: true, sidebar_fallback_for: "leads.lists", required_feature: "outbound_dialing", required_roles: ["owner", "producer", "assistant", "setter"] }),
      // AG-0.10 · the agency's Lead routing is Leads in's Route step too (LeadsInPage step="route"); out of Team
      // (2026-11-03), same key, gate and address. Listed only where the dialer's routing is not.
      item("Leads", { key: "team.routing", label: "Lead routing", path: "/app/lead-routing", icon: "route", teamOnly: true, sidebar_fallback_for: "leads.assignments", required_feature: "lead_assignment", required_roles: ["owner"], built: true, blurb: "Give every lead to a producer who can write it, before it goes cold." }),
      item("Leads", { key: "leads.nurture", label: "Lead recycling", path: "/app/nurture", icon: "recycle", built: true, sidebar_fallback_for: "leads.lists", required_feature: "outbound_dialing", required_roles: ["owner", "producer"] }),
      item("Leads", { key: "leads.duplicates", label: "Duplicate check", path: "/app/duplicates", icon: "copy-check", built: true, sidebar_fallback_for: "leads.lists", required_feature: "duplicate_detection", required_roles: ["owner", "producer", "assistant"] }),
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
      // AG-1.11 · Application review is a tab of Applications (2026-11-03, out of Team): it reads submitted
      // applications against LA-3's own checks. Same key, gate and address; listed only without Applications.
      item("Sales", { key: "team.review", sidebar_fallback_for: "sell.applications", label: "Application review", path: "/app/application-review", icon: "file-check", required_feature: "team_qa", required_roles: ["owner", "producer"], built: true, blurb: "Sampled applications checked against the submission checks." }),
      item("Sales", { key: "sell.deal-flow", label: "Daily deal flow", path: "/app/deal-flow", icon: "clipboard-list", required_feature: "daily_deal_flow", required_roles: ["owner", "producer"], built: true }),
    ],
  },
  {
    id: "retention",
    label: "Retention",
    items: [
      // Module 5 · Retention, one page (owner 2026-11-02: "all of these pages should go where they belong"): out of the
      // Book group into its own area, five steps down a rail (components/app/retention/retention-page.tsx). One link
      // (groupLink, no dropdown): each later page stands in for the one before. Lapse risk (LA-4.16, what the files
      // already show) went to Book of business; Carrier appointments (LA-0.5) to Compliance.
      // LA-5.3 · predicted, not observed: kept apart from Lapse risk so a guess never sits beside an emergency.
      // The key is kept (links and homes open it); since 2026-11-05 it is Cases, the ladder from the carrier files.
      item("Retention", { key: "retention.save-queue", groupLink: true, label: "Cases", path: "/app/retention", icon: "life-buoy", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer", "retention"], blurb: "Every policy the carrier files flag, at its risk point, with what to do." }),
      item("Retention", { key: "retention.payment-repair", groupLink: true, sidebar_fallback_for: "retention.save-queue", label: "Waiting on the carrier", path: "/app/servicing", icon: "wrench", built: true, required_feature: "payment_repair", required_roles: ["owner", "producer", "retention"], blurb: "Changes sent to the carrier, open until the next carrier file proves them." }),
      // A lapse inside its window is worked on its Retention case (critique 2026-11-05, D/E); this is Win-back.
      item("Retention", { key: "retention.winback", groupLink: true, sidebar_fallback_for: "retention.payment-repair", label: "Win-back", path: "/app/reinstatement", icon: "heart-handshake", built: true, required_feature: "winback", required_roles: ["owner", "producer", "retention"], blurb: "Former clients worth winning back, once the cooling-off has passed." }),
    ],
  },
  // Agency Module 0 (AG-1) · the Team group is gone (owner 2026-11-03, "the team should be rearranged somewhere
  // else"): Producers is the second step of Home › Agency, Hierarchy & overrides a Commissions step; Lead routing went
  // to Leads in, Commission splits and Producer payouts to Accounting, Producer scorecards to Reports, Application
  // review to Sales › Applications. Keys, gates and addresses kept.
  {
    id: "commissions",
    label: "Commissions",
    items: [
      // One Commissions link (owner 2026-11-02, as Accounting): groupLink, no dropdown. Round 7 (owner 2026-11-10,
      // mockups-r7/commissions.html 0·A): one rail in the order money moves — Statements, Pay issues, Who gets the credit,
      // then Producer pay, Team payouts, Commission splits, Partner payouts. Same keys, gates and addresses; each stands in
      // for the one before. A producer gets My pay.
      item("Commissions", { key: "book.statements", groupLink: true, label: "Statements", path: "/app/statements", icon: "file-text", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Carrier statements imported, matched to policies by a person, and posted to the commission ledger." }),
      item("Commissions", { key: "book.discrepancies", groupLink: true, sidebar_fallback_for: "book.statements", label: "Pay issues", path: "/app/discrepancies", icon: "scale", required_feature: "discrepancy_report", required_roles: ["owner", "bookkeeper"], blurb: "What the carrier paid against what they owed.", built: true }),
      item("Commissions", { key: "commissions.attribution", groupLink: true, sidebar_fallback_for: "book.discrepancies", label: "Who gets the credit", path: "/app/attribution", icon: "user-round-search", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Statement rows we could not safely give to one producer." }),
      // AG-1.12 · each producer's three truths.
      item("Commissions", { key: "commissions.producer_reconciliation", groupLink: true, sidebar_fallback_for: "commissions.attribution", label: "Producer pay", path: "/app/producer-reconciliation", icon: "arrow-left-right", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Expected, reported and received, per producer, never blended." }),
      item("Commissions", { key: "team.payouts", groupLink: true, sidebar_fallback_for: "commissions.producer_reconciliation", label: "Team payouts", navLabel: "Team payouts", path: "/app/producer-payouts", icon: "wallet-cards", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Pay your team for the month by each person's pay plan, with a private statement each." }),
      item("Commissions", { key: "team.splits", groupLink: true, sidebar_fallback_for: "team.payouts", label: "Commission splits", path: "/app/commission-splits", icon: "hand-coins", required_feature: "producer_payouts", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Policies two producers share, split after the override." }),
      item("Commissions", { key: "partners.payouts", groupLink: true, sidebar_fallback_for: "team.splits", label: "Partner payouts", path: "/app/payouts", icon: "wallet-cards", required_feature: "payout_runs", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Pay publishers from the ledger, not WhatsApp." }),
      // AG-1.5 / AG-1.8 · a producer's own pay: his ledger and his statements, opened without asking anyone.
      item("Commissions", { key: "commissions.my_pay", groupLink: true, sidebar_fallback_for: "partners.payouts", label: "My pay", path: "/app/my-pay", icon: "briefcase-business", required_feature: "producer_payouts", required_roles: ["producer"], built: true, blurb: "What you earned, what came back, and every statement." }),
    ],
  },
  {
    id: "data",
    label: "Book of business",
    items: [
      // One Book of business link (owner 2026-11-02, round 2; it was Data in): groupLink, no dropdown; each later
      // step stands in for the one before, so a producer (no Carrier files) still gets the one link. Since 2026-11-05
      // (owner: "carrier files, policies … and also commission ledger. So only these three") Needs you and Setup are
      // Carrier sync's, and the Commission ledger came from Commissions (same key, gate and address).
      item("Book of business", { key: "book.carrier_files", groupLink: true, label: "Carrier files", path: "/app/carrier-files", icon: "files", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Every policy and commission file a carrier sent, and where each one is: read, linked, moved, paid." }),
      item("Book of business", { key: "book.policies", groupLink: true, sidebar_fallback_for: "book.carrier_files", label: "Policies", path: "/app/policies", icon: "book-user", built: true, required_feature: "book_of_business", required_roles: ["owner", "producer", "bookkeeper"], blurb: "The book you already have" }),
      item("Book of business", { key: "book.ledger", groupLink: true, sidebar_fallback_for: "book.policies", label: "Commission ledger", path: "/app/ledger", icon: "receipt", required_feature: "commission_ledger", required_roles: ["owner", "producer", "bookkeeper"], built: true }),
      // The Rate card is Setup's first tab (/app/rate-card redirects there, owner 2026-11-02).
      item("Book of business", { key: "book.rate_card", sidebar: false, label: "Rate card", path: "/app/rate-card", icon: "calculator", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Your contract level and commission rates per carrier, and how much of your book they can check." }),
                ],
  },
  {
    // Carrier sync (owner 2026-11-05): one merged page holding Needs you and Setup (Rate card, Carrier rules, Pipeline
    // rules, Agent codes, Files in), out of Book of business. One link (groupLink); each later step stands in for the
    // one before. Keys, gates and addresses kept.
    id: "sync",
    label: "Carrier sync",
    items: [
      item("Carrier sync", { key: "book.needs_you", groupLink: true, label: "Needs you", path: "/app/needs-you", icon: "circle-alert", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "producer", "bookkeeper"], blurb: "Every decision the carrier files left for a person: a client to pick, a sale no carrier has, money that doesn't match." }),
      // Owner 2026-11-10: the menu lists the steps the Carrier sync rail shows (lib/dataIn/steps.ts), not "Setup".
      // book.setup is the Rate card (Setup's first step, same address); each later step stands in for the one before.
      item("Carrier sync", { key: "book.setup", groupLink: true, sidebar_fallback_for: "book.needs_you", label: "Rate card", path: "/app/book-setup", icon: "calculator", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Your contract level and commission rates per carrier, and how much of your book they can check." }),
      item("Carrier sync", { key: "book.carrier_terms", groupLink: true, sidebar_fallback_for: "book.setup", label: "Carrier terms", path: "/app/book-setup/carrier-rules", icon: "shield-check", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Each carrier's grace, reinstatement and chargeback windows." }),
      item("Carrier sync", { key: "book.card_moves", groupLink: true, sidebar_fallback_for: "book.carrier_terms", label: "Card moves", path: "/app/book-setup/pipeline-rules", icon: "split", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "When a carrier file moves a lead's card, and to which stage." }),
      item("Carrier sync", { key: "book.agent_codes", groupLink: true, sidebar_fallback_for: "book.card_moves", label: "Agent codes", path: "/app/book-setup/agent-codes", icon: "user-round-search", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "Which producer each carrier writing number belongs to." }),
      item("Carrier sync", { key: "book.files_in", groupLink: true, sidebar_fallback_for: "book.agent_codes", label: "Files in", path: "/app/book-setup/how-files-arrive", icon: "import", built: true, required_feature: "statement_ingestion", required_roles: ["owner", "bookkeeper"], blurb: "How your carrier files arrive, and your existing book." }),
      // Lapse risk (LA-4.16) is a Needs you view (owner 2026-11-02): what the carriers' files already show.
      item("Carrier sync", { key: "retention.lapse-risk", groupLink: true, sidebar_fallback_for: "book.files_in", label: "Lapse risk", path: "/app/lapse-risk", icon: "radar", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer", "retention"] }),
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    items: [
      // Round 7 (owner 2026-11-10, mockups-r7/accounting.html 0·B): Accounting opens on To do, everything waiting on a person;
      // the other keeper pages stand in for it.
      item("Accounting", { key: "accounting.todo", groupLink: true, label: "To do", path: "/app/accounting", icon: "list-checks", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Everything in Accounting that waits on you, oldest first." }),
      // LA-7.2 · lead invoices: what the agency paid for leads, per campaign.
      // 2026-10-26: Lead invoices and Vendor returns are one page, Vendor bills (key kept, as above).
      // One Accounting link (owner 2026-11-02, as Data in): groupLink, no dropdown. The owner's and bookkeeper's pages stand
      // in for Profit & loss; a producer gets Vendor returns, or My balance without returns.
      item("Accounting", { key: "accounting.invoices", groupLink: true, sidebar_fallback_for: "accounting.todo", label: "Vendor bills", path: "/app/vendor-bills", icon: "receipt-text", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What you paid for leads, and whether it matches what arrived." }),
      item("Accounting", { key: "insight.vendor-returns", groupLink: true, sidebar_fallback_for: "accounting.todo", label: "Vendor returns", path: "/app/vendor-returns", icon: "undo", required_feature: "true_cpa", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "Prepare evidence-backed claims and reconcile vendor credits." }),
      // LA-7.3 · expenses: tools, insurance, fees — acquisition or overhead.
      item("Accounting", { key: "accounting.expenses", groupLink: true, sidebar_fallback_for: "accounting.todo", label: "Expenses", path: "/app/expenses", icon: "credit-card", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Everything you spend that is not a lead." }),
      // LA-7.5 · producer splits: the agency's side, and each producer's own balance.
      item("Accounting", { key: "accounting.producer_splits", groupLink: true, sidebar_fallback_for: "accounting.todo", label: "Producer splits", path: "/app/producer-splits", icon: "split", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What each producer is owed, and what they owe back." }),
      item("Accounting", { key: "accounting.my_balance", groupLink: true, sidebar_fallback_for: "insight.vendor-returns", label: "My balance", path: "/app/my-balance", icon: "wallet", required_feature: "profit_and_loss", required_roles: ["producer"], built: true, blurb: "Your share of the commission, and what has come back." }),
      // LA-7.6 · bank deposits: the third truth about money — what actually arrived.
      item("Accounting", { key: "accounting.bank", groupLink: true, sidebar_fallback_for: "accounting.todo", label: "Bank deposits", path: "/app/bank", icon: "landmark", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What actually landed in the bank, matched to what carriers said they paid." }),
      item("Accounting", { key: "accounting.pnl", groupLink: true, sidebar_fallback_for: "accounting.todo", label: "Profit & loss", path: "/app/pnl", icon: "chart-line", required_feature: "profit_and_loss", required_roles: ["owner", "bookkeeper"], built: true, blurb: "Did this month make money." }),
                        item("Accounting", { key: "accounting.tax", groupLink: true, sidebar_fallback_for: "accounting.todo", label: "Tax summaries", path: "/app/tax", icon: "file-chart-column", required_feature: "tax_summaries", required_roles: ["owner", "bookkeeper"], built: true, blurb: "What the accountant asks for." }),
    ],
  },
  {
    id: "partners",
    label: "Partners",
    items: [
      // Publishers (owner, 2026-10-29), which also ends the clash with Leads › Lead sources, where two
      // menu items carried the same label for two different things.
      item("Partners", { key: "partners.publishers", label: "Publishers", navLabel: "Publishers", path: "/app/publishers", icon: "handshake", required_feature: "publisher_records", required_roles: ["owner", "bookkeeper"], built: true }),
      item("Partners", { key: "leads.partner-chat", label: "Partner chat", path: "/app/partner-chat", icon: "messages-square", built: true, required_feature: "inbound_transfers", required_roles: ["owner", "producer"] }),
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      // 2026-10-30 (owner: "all of the pages of compliance in one page", the Leads in treatment): the six pages
      // are steps of one page with its own rail (components/app/compliance/compliance-flow.tsx). They keep their
      // keys, gates and addresses; the sidebar shows the others only to someone who cannot open Overview
      // (an assistant or a setter reaches TCPA / DNC and the Consent locker).
      item("Compliance", { key: "compliance.dashboard", label: "Compliance", navLabel: "Overview", groupLink: true, path: "/app/compliance", icon: "scale", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer"], blurb: "Am I exposed right now: deadlines, gaps and coverage on one screen." }),
      item("Compliance", { key: "compliance.tcpa", sidebar_fallback_for: "compliance.dashboard", label: "TCPA / DNC", path: "/app/tcpa", icon: "phone-off", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer", "assistant", "setter"] }),
      item("Compliance", { key: "compliance.consent", sidebar_fallback_for: "compliance.dashboard", label: "Consent locker", path: "/app/consent", icon: "lock-keyhole", built: true, required_feature: "consent_locker", required_roles: ["owner", "producer", "assistant"] }),
      item("Compliance", { key: "compliance.complaints", sidebar_fallback_for: "compliance.dashboard", label: "Complaints", path: "/app/complaints", icon: "circle-alert", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer"], blurb: "Every complaint with an owner, a deadline and a countdown." }),
      item("Compliance", { key: "compliance.deletions", sidebar_fallback_for: "compliance.dashboard", label: "Deletion requests", path: "/app/deletion-requests", icon: "user-x", built: true, required_feature: "tcpa_checker", required_roles: ["owner", "producer"], blurb: "One person asks to be deleted: verify, hold, delete, certify." }),
      item("Compliance", { key: "compliance.litigation", sidebar_fallback_for: "compliance.dashboard", label: "Evidence report", path: "/app/evidence-report", icon: "gavel", built: true, required_feature: "litigation_packet", required_roles: ["owner", "producer"], blurb: "Everything we hold about one number, and every gap." }),
      // LA-0.5 · Licences & appointments, a Compliance step (owner 2026-11-02): LA-6.2's licence gate reads it.
      item("Compliance", { key: "book.appointments", sidebar_fallback_for: "compliance.dashboard", label: "Carrier appointments", path: "/app/appointments", icon: "badge-check", required_feature: "appointment_vault", required_roles: ["owner", "producer"], built: true }),
    ],
  },
  {
    id: "reports",
    label: "Reports",
    items: [
      // One page with six views (owner 2026-10-30, components/app/reports/reports-page.tsx): the sidebar shows
      // one Reports link (groupLink: no dropdown) to the first view this person may open; each later view stands in for the one before.
      item("Reports", { key: "insight.sales-performance", groupLink: true, label: "Sales performance", path: "/app/sales-performance", icon: "chart-column", built: true, required_feature: "sales_report", required_roles: ["owner", "producer", "bookkeeper"], blurb: "Funnel, timings and why carriers decline." }),
      item("Reports", { key: "insight.activity", groupLink: true, sidebar_fallback_for: "insight.sales-performance", label: "Team activity", path: "/app/activity", icon: "activity", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer", "setter"] }),
      item("Reports", { key: "insight.scoring", groupLink: true, sidebar_fallback_for: "insight.activity", label: "Queue scoring", path: "/app/scoring", icon: "brain", built: true, required_feature: "outbound_dialing", required_roles: ["owner", "producer"], blurb: "The order leads are served in, and whether it beats the plain order." }),
      item("Reports", { key: "insight.book-scorecards", groupLink: true, sidebar_fallback_for: "insight.scoring", label: "Book scorecards", path: "/app/book-scorecards", icon: "gauge", required_feature: "cohort_persistency", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "Persistency, placement, chargebacks and true cost per sale, from your carrier files." }),
      item("Reports", { key: "insight.true-cpa", groupLink: true, sidebar_fallback_for: "insight.book-scorecards", label: "True CPA", path: "/app/true-cpa", icon: "badge-dollar-sign", required_feature: "true_cpa", required_roles: ["owner", "producer", "bookkeeper"], built: true, blurb: "What your leads actually cost" }),
      item("Reports", { key: "partners.review", groupLink: true, sidebar_fallback_for: "insight.true-cpa", label: "Partner quality", path: "/app/partner-quality", icon: "award", required_feature: "partner_quality", required_roles: ["owner", "producer", "bookkeeper"], built: true }),
      // LA-5.8 / LA-5.9 · Module 5's reports (owner 2026-11-02): out of Retention into Reports; "Does it work?" renamed.
      item("Reports", { key: "retention.scorecard", groupLink: true, sidebar_fallback_for: "partners.review", label: "Retention scorecard", path: "/app/retention-scorecard", icon: "chart-no-axes-combined", built: true, required_feature: "chargeback_radar", required_roles: ["owner", "producer", "retention"], blurb: "Policies worked, contact rate and save rate by reason, per person." }),
      item("Reports", { key: "retention.results", groupLink: true, sidebar_fallback_for: "retention.scorecard", label: "Retention results", path: "/app/retention-results", icon: "chart-line", built: true, required_feature: "chargeback_radar", required_roles: ["owner"], blurb: "Whether the risk bands came true, and what working the queue saved, from your own book." }),
      // AG-1.9 · a report, so a Reports view (2026-11-03, out of Team); same key, gate and address.
      item("Reports", { key: "team.scorecards", groupLink: true, sidebar_fallback_for: "insight.sales-performance", label: "Producer scorecards", navLabel: "Scorecards", path: "/app/producer-scorecards", icon: "gauge", required_feature: "producer_scorecards", required_roles: ["owner", "bookkeeper", "producer"], built: true, blurb: "Who is profitable, not just busy." }),
      // AG-1.2 · a Reports view (owner 2026-11-05: "Put hierarchy and overrides on reports"; it was a Commissions step).
      // Same key, gate and address; a manager whose plan has no other report still gets the one Reports link.
      item("Reports", { key: "team.hierarchy", groupLink: true, sidebar_fallback_for: "team.scorecards", label: "Hierarchy & Overrides", navLabel: "Hierarchy", path: "/app/hierarchy", icon: "network", required_feature: "team_hierarchy", required_roles: ["owner", "bookkeeper", "manager"], built: true, blurb: "Who reports to whom, and what the agency keeps on each producer." }),
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
  "book.needs_you", "insight.vendor-returns", "insight.scoring", "insight.true-cpa", "partners.review",
  "compliance.dashboard", "compliance.tcpa", "compliance.consent", "compliance.complaints", "compliance.deletions", "compliance.litigation",
]);

/**
 * Custom team access: `extraRoles` are the member's other roles (the union opens an item), `hiddenPages` the menu
 * keys the owner hid for them (removed whatever their roles allow; Settings is never hidden).
 */
export function buildAgentMenu(
  grantedFeatureKeys: Iterable<string>,
  role: MemberRole = "owner",
  options: { agencyNarrow?: boolean; extraRoles?: readonly MemberRole[]; hiddenPages?: readonly string[]; solo?: boolean } = {},
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
      !(options.solo && entry.teamOnly) &&
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
