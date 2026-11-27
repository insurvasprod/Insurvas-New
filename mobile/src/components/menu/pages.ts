import type { IconName } from "@/components/icon";

/**
 * The web sidebar's pages as board J1 groups them, each with the web's own key, address and role gate
 * (lib/menu/definition.ts, AGENT_MENU). Calls, Leads and Inbox are tabs, so they are not repeated.
 * `feature` is the web's required_feature: /api/app/me names the plan's features (2026-11-26), and a
 * page the plan does not include is left out, as on the web. `why` is the web's blurb, shown on the hand-off.
 * `server` is the phone screen's own route gate where it is narrower than the web menu's: the row only shows to
 * the base roles and plan that route answers, whatever `menuKeys` says (a refusal is not a page).
 */
export type WebPage = { key: string; label: string; path: string; icon: IconName; roles: string[]; feature?: string; why?: string; server?: { roles: string[]; feature: string } };
export type WebGroup = { title: string; pages: WebPage[] };

const O = "owner", P = "producer", A = "assistant", S = "setter", B = "bookkeeper", R = "retention", M = "manager";

export const WEB_GROUPS: WebGroup[] = [
  { title: "Today", pages: [
    { key: "setup", label: "Get set up", path: "/app/setup", icon: "listCheck", roles: [O], why: "The steps left before the agency can dial, sell and get paid." },
    { key: "sell.calendar", feature: "outbound_dialing", label: "Calendar", path: "/app/calendar", icon: "calendar", roles: [O, P, A, S] },
    { key: "sell.setters", feature: "outbound_dialing", label: "Appointments & setters", path: "/app/setters", icon: "headset", roles: [O, P], why: "Your day and the setters who book into it." },
  ] },
  { title: "Leads", pages: [
    { key: "leads.lists", feature: "lead_import", label: "Lead flow", path: "/app/lead-sources", icon: "package", roles: [O, P, A], why: "Where leads come from, what each batch brought, and how they are handed out." },
    { key: "leads.import", feature: "lead_import", label: "List import", path: "/app/import", icon: "upload", roles: [O, P, A], why: "You map columns side by side with the file, review thousands of rows and fix them in bulk." },
    { key: "leads.campaigns", feature: "outbound_dialing", label: "Vendors & campaigns", path: "/app/campaigns", icon: "store", roles: [O, P], why: "Who you buy from, what each batch cost, and what a dialable lead really costs." },
  ] },
  { title: "Sales", pages: [
    { key: "sell.applications", feature: "applications", label: "Applications", path: "/app/applications", icon: "filePen", roles: [O, P], why: "Carrier applications, filled in-app." },
    { key: "sell.pending", feature: "applications", label: "Pending cases", path: "/app/pending", icon: "hourglass", roles: [O, P], why: "Everything between submitted and issued." },
    { key: "sell.quoting", feature: "quoting", label: "Quote", path: "/app/quoting", icon: "calc", roles: [O, P], why: "Compare carrier premiums side by side." },
    { key: "sell.deal-flow", feature: "daily_deal_flow", label: "Daily deal flow", path: "/app/deal-flow", icon: "clipboard", roles: [O, P] },
  ] },
  { title: "Book of business", pages: [
    { key: "book.policies", feature: "book_of_business", label: "Policies", path: "/app/policies", icon: "book", roles: [O, P, B] },
    { key: "book.needs_you", feature: "statement_ingestion", label: "Needs you", path: "/app/needs-you", icon: "listCheck", roles: [O, P, B], why: "The few decisions the carrier files leave to a person." },
    { key: "book.ledger", feature: "commission_ledger", label: "Commission ledger", path: "/app/ledger", icon: "receipt", roles: [O, P, B] },
    { key: "book.carrier_files", feature: "statement_ingestion", label: "Carrier files", path: "/app/carrier-files", icon: "files", roles: [O, B] },
  ] },
  { title: "Retention", pages: [
    { key: "retention.save-queue", feature: "chargeback_radar", label: "Cases", path: "/app/retention", icon: "buoy", roles: [O, P, R], why: "Every policy the carrier files flag, at its risk point, with what to do." },
    { key: "retention.payment-repair", feature: "payment_repair", label: "Waiting on the carrier", path: "/app/servicing", icon: "wrench", roles: [O, P, R], why: "Changes sent to the carrier, open until the next carrier file proves them." },
    { key: "retention.winback", feature: "winback", label: "Win-back", path: "/app/reinstatement", icon: "heart", roles: [O, P, R], why: "Former clients worth winning back, once the cooling-off has passed." },
  ] },
  { title: "Commissions", pages: [
    { key: "book.statements", feature: "statement_ingestion", label: "Statements", path: "/app/statements", icon: "file", roles: [O, B], why: "Carrier statements imported, matched to policies by a person, and posted to the commission ledger." },
    { key: "commissions.my_pay", feature: "producer_payouts", label: "My pay", path: "/app/my-pay", icon: "wallet", roles: [P], why: "What you earned, what came back, and every statement." },
  ] },
  { title: "Accounting", pages: [
    { key: "accounting.todo", feature: "profit_and_loss", label: "To do", path: "/app/accounting", icon: "listCheck", roles: [O, B] },
    { key: "accounting.pnl", feature: "profit_and_loss", label: "Profit & loss", path: "/app/pnl", icon: "chart", roles: [O, B] },
    { key: "accounting.expenses", feature: "profit_and_loss", label: "Add an expense", path: "/app/expenses/new", icon: "camera", roles: [O, B], why: "Snap the receipt; the expense is filled from it." },
    { key: "book.discrepancies", feature: "discrepancy_report", label: "Pay issues", path: "/app/discrepancies", icon: "receipt", roles: [O, B], why: "Commission that came in short, late or not at all, by carrier." },
    { key: "accounting.my_balance", feature: "profit_and_loss", label: "My balance", path: "/app/my-balance", icon: "wallet", roles: [P] },
  ] },
  { title: "Partners", pages: [
    { key: "partners.publishers", feature: "publisher_records", label: "Publishers", path: "/app/publishers", icon: "handshake", roles: [O, B] },
    { key: "leads.partner-chat", feature: "inbound_transfers", label: "Partner chat", path: "/app/partner-chat", icon: "msgs", roles: [O, P] },
  ] },
  { title: "Compliance", pages: [
    // The phone's check runs on POST /api/app/dial/preflight: owners and producers (an admin or a manager holds one
    // of those base roles) on a plan with outbound_dialing. A setter or an assistant would only be refused.
    { key: "compliance.tcpa", feature: "tcpa_checker", label: "Check a number", path: "/app/tcpa", icon: "shield", roles: [O, P], server: { roles: [O, P], feature: "outbound_dialing" } },
    { key: "compliance.consent", feature: "consent_locker", label: "Consent locker", path: "/app/consent", icon: "lock", roles: [O, P, A] },
    { key: "book.appointments", feature: "appointment_vault", label: "Carrier appointments", path: "/app/appointments", icon: "badge", roles: [O, P] },
    { key: "compliance.complaints", feature: "tcpa_checker", label: "Complaints", path: "/app/complaints", icon: "msgs", roles: [O, P] },
  ] },
  { title: "Reports", pages: [
    { key: "insight.reports", label: "All reports", path: "/app/reports", icon: "chart", roles: [O, P, B, R, M, S, A] },
    { key: "retention.scorecard", feature: "chargeback_radar", label: "Retention scorecard", path: "/app/retention-scorecard", icon: "buoy", roles: [O, R] },
    { key: "partners.review", feature: "partner_quality", label: "Partner quality", path: "/app/partner-quality", icon: "handshake", roles: [O] },
    { key: "insight.sales-performance", feature: "sales_report", label: "Sales performance", path: "/app/sales-performance", icon: "chart", roles: [O, P, B] },
    { key: "insight.activity", feature: "outbound_dialing", label: "Team activity", path: "/app/activity", icon: "activity", roles: [O, P, S] },
    { key: "insight.callbacks", feature: "callback_calendar", label: "Callbacks kept", path: "/app/callback-results", icon: "calCheck", roles: [O, P, A] },
    { key: "team.hierarchy", feature: "team_hierarchy", label: "Hierarchy & overrides", path: "/app/hierarchy", icon: "network", roles: [O, B, M] },
  ] },
];

/** A person's gold initials: "Jordan Reyes" → "JR" (an email falls back to its first letters). */
export function initialsOf(name: string): string {
  return name.split(/[\s@.]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/**
 * Calls and Leads are tabs, so the menu leaves them out, except for an owner or admin on the Team · Money
 * tabs: they still sell, so Today carries the Dialer, Callbacks and Incoming, and Leads carries the board.
 * Each opens the pushed twin of the tab (/calls-page, /leads-page).
 */
const CALLS_ROWS: WebPage[] = [
  { key: "leads.dialer", feature: "outbound_dialing", label: "Dialer", path: "/app/dialer", icon: "phoneOut", roles: [O] },
  { key: "sell.callbacks", feature: "callback_calendar", label: "Callbacks", path: "/app/callbacks", icon: "calCheck", roles: [O] },
  { key: "leads.inbound", feature: "inbound_transfers", label: "Incoming transfers", path: "/app/inbound", icon: "phoneIn", roles: [O] },
];
const LEADS_ROW: WebPage = { key: "leads.workspace", feature: "lead_import", label: "Leads", path: "/app/leads", icon: "contact", roles: [O] };

function tabRows(title: string, tabs: readonly string[] | undefined): WebPage[] {
  if (!tabs) return [];
  if (title === "Today" && !tabs.includes("calls")) return CALLS_ROWS;
  if (title === "Leads" && !tabs.includes("leads")) return [LEADS_ROW];
  return [];
}

/** Rows with no web sidebar item (the web adds Get set up on its own; All reports is the phone's index). */
const PHONE_ONLY_KEYS = new Set(["setup", "insight.reports"]);

/**
 * The groups this person opens, plus the Calls and Leads rows when those are not tabs (`tabs`).
 *
 * `menuKeys` (GET /api/app/me, 2026-11-26) is the web sidebar's own list for this person: plan, member role and
 * extra roles, the agency scope (AG-0.5: inside an agency a producer, manager, assistant or setter is not offered
 * Consent locker, Complaints and the other agency screens, whose APIs refuse them), the pages the owner hid, solo
 * mode. When the server sends it, it decides every row that has a web key. Without it (an older server) the
 * roles below and the plan's `features` decide, as before.
 */
export function groupsFor(roles: (string | null | undefined)[], options: { features?: readonly string[] | null; tabs?: readonly string[]; menuKeys?: readonly string[] | null; baseRole?: string | null } = {}): WebGroup[] {
  const have = new Set(roles.filter(Boolean) as string[]);
  const { features, tabs, menuKeys } = options;
  // The server's base role (me.role) when given; without it, any of the person's roles.
  const base = options.baseRole;
  const byRole = (pg: WebPage) => pg.roles.some((r) => have.has(r)) && (!pg.feature || !features || features.includes(pg.feature));
  const serverOpens = (pg: WebPage) => !pg.server || ((base ? pg.server.roles.includes(base) : pg.server.roles.some((r) => have.has(r))) && (!features || features.includes(pg.server.feature)));
  const opens = (pg: WebPage) => serverOpens(pg) && (menuKeys && !PHONE_ONLY_KEYS.has(pg.key) ? menuKeys.includes(pg.key) : byRole(pg));
  return WEB_GROUPS.map((g) => ({ ...g, pages: [...tabRows(g.title, tabs), ...g.pages].filter(opens) })).filter((g) => g.pages.length);
}
