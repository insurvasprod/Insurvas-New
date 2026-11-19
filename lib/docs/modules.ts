/**
 * Docs R6 (owner 2026-11-16, board docs/design/docs-r6): Docs is for using Insurvas, module by module. Each module
 * has a guide (How it works · Why we built it · What it does for you · You'll need first, template A) and its
 * tasks ("how do I…", lib/docs/tasks.ts), each task on real screenshots. The home page is the lead-to-money map
 * (board B): the six modules a lead passes through, the three under them, and the rest beside.
 */

export type DocModuleKey =
  | "leads" | "today" | "sales" | "book" | "commissions" | "accounting"
  | "retention" | "compliance" | "reports"
  | "carrier-sync" | "partners" | "home" | "agency";

export type DocModule = {
  key: DocModuleKey;
  title: string;
  /** Where it sits on the home map: the lead-to-money line, under it, or beside it. */
  lane: "main" | "under" | "beside";
  /** The map box's two lines: what you do there ("Buy and import") and what it covers. */
  verb: string;
  covers: string;
  /** Under-lane boxes say how they relate to the line ("Keeps the money"). */
  relation?: string;
  /** The guide's one big line. */
  promise: string;
  how: { title: string; detail: string }[];
  why: string[];
  forYou: { role: string; text: string[] }[];
  open: { href: string; label: string };
  minutes: number;
};

export const DOC_MODULES: readonly DocModule[] = [
  {
    key: "leads", title: "Leads", lane: "main", verb: "Buy and import", covers: "Vendors, campaigns, the DNC check",
    promise: "Every lead you buy, traced to the vendor that sold it, checked before anyone dials it.",
    how: [
      { title: "Campaign", detail: "Each lead buy is a campaign under its vendor" },
      { title: "Import", detail: "The vendor's file goes into that campaign" },
      { title: "Checked", detail: "Do-not-call, litigators, duplicates" },
      { title: "Routed", detail: "To agents licensed in the lead's state" },
      { title: "Recycled", detail: "Leads nobody reached come back" },
    ],
    why: ["Spreadsheets lose where a lead came from, so nobody knows which vendor really sells.", "One TCPA claim from a bad list costs more than the list."],
    forYou: [
      { role: "Owner", text: ["Cost per sale for every vendor and campaign.", "Bad lists are caught before they're dialed."] },
      { role: "Producer", text: ["Only clean leads you can legally call, in your states."] },
    ],
    open: { href: "/app/lead-sources", label: "Open Lead flow" }, minutes: 4,
  },
  {
    key: "today", title: "Today: calls", lane: "main", verb: "Call and transfer", covers: "Dialer, inbound, callbacks",
    promise: "One button all day: the next person to call, inside the hours the law allows.",
    how: [
      { title: "Your queue", detail: "Leads assigned to you, inside calling hours" },
      { title: "Serve next", detail: "The dialer picks the best lead next" },
      { title: "Transfers", detail: "Claim an inbound call before its time runs out" },
      { title: "The call", detail: "Check, verify, underwriting, finish" },
      { title: "Outcome", detail: "Moves the lead, or books a callback" },
    ],
    why: ["Agents lose the first hour of every day deciding who to call.", "Calling outside the hours, or forgetting a callback, loses the sale or breaks the law."],
    forYou: [
      { role: "Producer", text: ["One button, Serve next lead, all day.", "Callbacks come back to you on time."] },
      { role: "Manager", text: ["No transfer sits unclaimed.", "You see who is on a call."] },
    ],
    open: { href: "/app/dialer", label: "Open the dialer" }, minutes: 4,
  },
  {
    key: "sales", title: "Sales", lane: "main", verb: "Quote and apply", covers: "Applications, pending cases",
    promise: "From quote to submitted without leaving the call, and no case lost after it.",
    how: [
      { title: "Quote", detail: "Products you sell, carriers you're appointed with" },
      { title: "Apply", detail: "Health questions, beneficiary, payment, once" },
      { title: "Submit", detail: "The case moves into underwriting" },
      { title: "Pending", detail: "Follow it until it's issued" },
      { title: "Draft date", detail: "When the first premium comes out" },
    ],
    why: ["Each carrier portal asks the same things differently, and cases get lost between them.", "A missed draft date is a policy that never goes in force."],
    forYou: [
      { role: "Producer", text: ["Quote to submitted on one screen."] },
      { role: "Owner", text: ["Daily deal flow: what was written today, and by whom."] },
    ],
    open: { href: "/app/applications", label: "Open Applications" }, minutes: 5,
  },
  {
    key: "book", title: "Book of business", lane: "main", verb: "Issued and in force", covers: "Policies, carrier files",
    promise: "Your whole book in one place: every policy, its status and every dollar on it.",
    how: [
      { title: "Carrier files", detail: "Upload each carrier's policy report" },
      { title: "Policies", detail: "Issued, in force, lapsed, charged back" },
      { title: "One page each", detail: "Premium, commission and history" },
      { title: "Ledger", detail: "Every dollar per policy" },
    ],
    why: ["Your book is spread across carrier portals. Nobody has the whole picture.", "Retention and commission checks need one true list of policies."],
    forYou: [
      { role: "Owner", text: ["The agency's real book, and what it's worth."] },
      { role: "Producer", text: ["Your own policies and their status."] },
    ],
    open: { href: "/app/carrier-files", label: "Open Book of business" }, minutes: 4,
  },
  {
    key: "commissions", title: "Commissions", lane: "main", verb: "Get paid right", covers: "Statements, pay issues, payouts",
    promise: "Get paid every dollar the carriers owe you, and pay your team from what really came in.",
    how: [
      { title: "Statements", detail: "Upload what each carrier sent" },
      { title: "Matched", detail: "Each line to a policy" },
      { title: "Pay issues", detail: "Missing, short, wrong chargebacks" },
      { title: "Who gets the credit", detail: "Producer, splits, overrides" },
      { title: "Pay out", detail: "Producers, team, partners" },
    ],
    why: ["Carriers short-pay, miss advances and charge back the wrong policy. Agencies lose a few percent of revenue to it without knowing.", "Checking a statement by hand takes hours, so most agencies don't."],
    forYou: [
      { role: "Owner", text: ["Every statement is checked against your book in minutes.", "Money owed comes back: claim it with a letter Insurvas writes.", "Producer pay comes from reconciled numbers, so there are no pay disputes."] },
      { role: "Producer", text: ["My pay shows exactly what you earned and why."] },
      { role: "Bookkeeper", text: ["One place for statements, pay issues and payouts."] },
    ],
    open: { href: "/app/statements", label: "Open Commissions" }, minutes: 5,
  },
  {
    key: "accounting", title: "Accounting", lane: "main", verb: "Know your profit", covers: "Bills, bank, P&L",
    promise: "Your real profit, by month and by vendor, without a second bookkeeping tool.",
    how: [
      { title: "Vendor bills", detail: "Checked against the leads you got" },
      { title: "Bank", detail: "Deposits matched to statements" },
      { title: "Expenses", detail: "Each in its month and bucket" },
      { title: "P&L", detail: "Profit and tax summaries build themselves" },
    ],
    why: ["Agencies overpay vendors and don't know their real profit per month.", "A separate bookkeeping tool never knows about leads or policies."],
    forYou: [
      { role: "Bookkeeper", text: ["One To do list each month."] },
      { role: "Owner", text: ["Real profit, by month and by vendor."] },
    ],
    open: { href: "/app/accounting", label: "Open Accounting" }, minutes: 4,
  },
  {
    key: "retention", title: "Retention", lane: "under", relation: "Keeps the money · under the book", verb: "Save policies", covers: "Saves policies before a chargeback",
    promise: "Save a policy before it lapses, so the carrier never takes the advance back.",
    how: [
      { title: "Lapse risk", detail: "Missed draft, payment problem, carrier notice" },
      { title: "Cases", detail: "At-risk policies in a save queue" },
      { title: "Work it", detail: "Call, fix the payment, re-date the draft" },
      { title: "Win-back", detail: "Lost ones get one more try" },
    ],
    why: ["A lapse in year one means the carrier takes the advance back.", "Saving a policy is far cheaper than selling a new one."],
    forYou: [
      { role: "Owner", text: ["Fewer chargebacks, better persistency, a higher contract level."] },
      { role: "Specialist", text: ["One queue, best saves first."] },
    ],
    open: { href: "/app/retention", label: "Open Retention" }, minutes: 3,
  },
  {
    key: "compliance", title: "Compliance", lane: "under", relation: "Keeps you safe · under every step", verb: "Stay safe", covers: "Consent, DNC, evidence, appointments",
    promise: "Proof ready before anyone asks for it: consent, checks, deadlines.",
    how: [
      { title: "Consent", detail: "Every lead's consent kept in the locker" },
      { title: "Checks", detail: "DNC and litigators, on import and before dialing" },
      { title: "Requests", detail: "Complaints and deletions, with deadlines" },
      { title: "Evidence", detail: "One report when a claim arrives" },
    ],
    why: ["A single TCPA claim can cost more than a year's profit.", "The proof must exist before the claim, not after."],
    forYou: [
      { role: "Owner", text: ["Proof ready, deadlines met."] },
      { role: "Producer", text: ["You can't dial someone you shouldn't."] },
    ],
    open: { href: "/app/compliance", label: "Open Compliance" }, minutes: 4,
  },
  {
    key: "reports", title: "Reports", lane: "under", relation: "Tells you what works · reads them all", verb: "See what works", covers: "True CPA, scorecards, persistency",
    promise: "Which vendor, which producer and which carrier make you money.",
    how: [
      { title: "One set of data", detail: "Leads, calls, applications, policies, money" },
      { title: "A period", detail: "Pick it once for every report" },
      { title: "Click through", detail: "Every number opens its records" },
    ],
    why: ["The real questions (which vendor, which producer, which carrier) need lead-to-money data in one place."],
    forYou: [
      { role: "Owner", text: ["True cost per sale before you buy more leads."] },
      { role: "Manager", text: ["Who needs coaching, from activity and placement."] },
    ],
    open: { href: "/app/sales-performance", label: "Open Reports" }, minutes: 3,
  },
  {
    key: "carrier-sync", title: "Carrier sync", lane: "beside", verb: "Read carrier files", covers: "Agent codes, carrier terms, Needs you",
    promise: "Set each carrier up once, and every file it sends reads itself.",
    how: [
      { title: "Carrier terms", detail: "Rates, advance, chargeback window" },
      { title: "Agent codes", detail: "Each code mapped to a person" },
      { title: "Files in", detail: "Every file read the same way" },
      { title: "Needs you", detail: "Only what it couldn't place" },
    ],
    why: ["Every carrier's file looks different. Without a setup, every month is manual.", "An unknown agent code means unpaid commission."],
    forYou: [{ role: "Owner", text: ["Set up once, then a few minutes a month on Needs you."] }, { role: "Bookkeeper", text: ["No re-keying carrier files."] }],
    open: { href: "/app/needs-you", label: "Open Carrier sync" }, minutes: 3,
  },
  {
    key: "partners", title: "Partners", lane: "beside", verb: "Work with partners", covers: "Publishers, partner chat",
    promise: "Every partner who sends you leads, in one channel, paid for what converts.",
    how: [
      { title: "Publishers", detail: "Each one who sends leads or transfers" },
      { title: "Portal and chat", detail: "Their own portal, and a chat with you" },
      { title: "Tracked", detail: "Every lead and transfer to a result" },
    ],
    why: ["Publisher deals live in texts and email, and quality is guessed."],
    forYou: [{ role: "Owner", text: ["Pay partners for what converts, from their quality report."] }],
    open: { href: "/app/publishers", label: "Open Publishers" }, minutes: 3,
  },
  {
    key: "home", title: "Home and dashboards", lane: "beside", verb: "Start the day", covers: "Home, agency dashboard, compare",
    promise: "What to do today, and whether the agency is healthy, each on one screen.",
    how: [
      { title: "Home", detail: "Needs you, Today, My numbers, Shortcuts" },
      { title: "Agency", detail: "Five figures, business health, producers" },
      { title: "Compare", detail: "Two periods or two people side by side" },
    ],
    why: ["Every number links to the records behind it, so nobody exports to a spreadsheet."],
    forYou: [{ role: "Producer", text: ["Start every day from Home."] }, { role: "Owner", text: ["The agency on one screen each week."] }],
    open: { href: "/app/dashboard", label: "Open Home" }, minutes: 2,
  },
  {
    key: "agency", title: "Your agency", lane: "beside", verb: "Set up the agency", covers: "Carriers, states, products, team",
    promise: "The agency facts everything else reads: carriers, states, products, people.",
    how: [
      { title: "Carriers", detail: "Who you're contracted with" },
      { title: "States", detail: "Where you're appointed" },
      { title: "Products", detail: "What you sell" },
      { title: "Team", detail: "Who works here, and their role" },
    ],
    why: ["Quotes, routing and commission checks all read these, so they're set once, here."],
    forYou: [{ role: "Owner", text: ["Set once, used everywhere."] }],
    open: { href: "/app/settings", label: "Open Settings" }, minutes: 2,
  },
];

export function docModule(key: string): DocModule | null {
  return DOC_MODULES.find((item) => item.key === key) ?? null;
}
