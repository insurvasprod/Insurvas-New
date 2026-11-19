import type { DocModuleKey } from "./modules.ts";

/**
 * Docs tasks (owner 2026-11-16, board docs/design/docs-r6/docs-page.html A): "how do I do this in Insurvas", one
 * page each, every step on a real screenshot. A task that is a Get set up step (`setupStep`) uses that step's guide
 * moves, screenshots and done fact; any other lists its `steps`, photographed by scripts/docs-task-shots.mjs.
 *
 * A step's `find` is how the screenshot script lights its control: `guide:x` ([data-guide="x"]), `text:Label` (a
 * button, link or tab by name), `label:Name` (a field by its label) or a CSS selector. `then: "open"` lets the script
 * click it to reach the next screen, and is only ever set on a control that opens something (a tab, sheet, record or
 * menu), never on one that saves, sends, pays or publishes. `at` sends the script to a page first.
 *
 * `done` names the fact Insurvas checks (lib/docs/taskFacts.ts) to tick the task in your agency. A task with no
 * `done` is a look-up with nothing to finish, and isn't counted in progress.
 */

export type DocTaskStep = { say: string; detail?: string; find?: string; then?: "open"; at?: string };

export type DocTask = {
  slug: string;
  module: DocModuleKey;
  title: string;
  minutes: number;
  open: { href: string; label: string };
  setupStep?: string;
  steps?: DocTaskStep[];
  /** Tasks to do first (by slug). */
  needs?: string[];
  why: string;
  whenDone: string;
  done?: string;
};

const setup = (module: DocModuleKey, slug: string, title: string, minutes: number, open: DocTask["open"], whenDone: string, needs?: string[]): DocTask => ({
  slug, module, title, minutes, open, setupStep: slug, why: "", whenDone, done: `setup:${slug}`, ...(needs ? { needs } : {}),
});

export const DOC_TASKS: readonly DocTask[] = [
  // ── Leads ──
  setup("leads", "campaign", "Create a campaign", 3, { href: "/app/campaigns", label: "Open Vendors & campaigns" }, "The campaign is in Vendors & campaigns, ready for its list.", ["products"]),
  setup("leads", "import", "Import a lead list", 10, { href: "/app/import", label: "Open List import" }, "The leads that passed the checks are in the campaign and can be dialed.", ["campaign"]),
  setup("leads", "assign", "Route leads to your agents", 3, { href: "/app/assignments", label: "Open Lead routing" }, "Each agent's dialer holds the leads routed to them.", ["import", "team"]),
  {
    slug: "recycle-leads", module: "leads", title: "Recycle leads nobody reached", minutes: 3, open: { href: "/app/nurture", label: "Open Lead recycling" },
    steps: [
      { say: "Click Bring back on a campaign", detail: "Each row is a campaign with leads nobody reached.", find: "text:Bring back", then: "open" },
      { say: "Type the new angle, then click Scrub and bring back", detail: "They're checked against do-not-call again before they're dialed.", find: "text:Scrub and bring back" },
    ],
    needs: ["import"], why: "A lead nobody reached is already paid for. Bringing it back with a new angle costs nothing.",
    whenDone: "The leads are back in the dialer, and the batch shows in recycling.", done: "recycled",
  },
  {
    slug: "check-duplicates", module: "leads", title: "Check duplicates", minutes: 3, open: { href: "/app/duplicates", label: "Open Duplicate check" },
    steps: [
      { say: "Open the Duplication tab", detail: "Pairs Insurvas thinks are the same person, one at a time.", find: "text:Duplication", then: "open" },
      { say: "Click Yes, merge them, or No, keep both", detail: "A merge keeps every call and note from both.", find: "text:merge them" },
    ],
    needs: ["import"], why: "Two records for one person means two agents calling them, and a complaint.",
    whenDone: "The pair is merged, or marked as two people, and leaves the list.", done: "duplicates",
  },

  // ── Today ──
  {
    slug: "call-next-lead", module: "today", title: "Call your next lead", minutes: 2, open: { href: "/app/dialer", label: "Open the dialer" },
    steps: [
      { say: "Click the phone beside the lead to call them", detail: "Your queue: leads routed to you, inside their calling hours, best first.", find: "table tbody tr:first-child td:last-child button, table tbody tr:first-child td:last-child a" },
      { say: "Call them, then record what happened", detail: "The outcome moves the lead, or books a callback.", find: "guide:disposition-open" },
    ],
    needs: ["assign", "calling-windows"], why: "No list to scroll, and no lead called outside the hours the law allows.",
    whenDone: "The call and its outcome are on the lead's timeline.", done: "called",
  },
  {
    slug: "claim-transfer", module: "today", title: "Claim a transfer", minutes: 1, open: { href: "/app/inbound", label: "Open Inbound" },
    steps: [{ say: "Click Take this call on the next caller", detail: "A waiting caller's card shows here, with Take this call. Claim it before its time runs out, or it escalates.", find: "[data-guide='inbound-claim'], section[aria-label='Nobody in line']" }],
    needs: ["lead-sources", "queue-sla"], why: "A live transfer is the most expensive lead you buy: nobody should let one wait.",
    whenDone: "The call opens on the call screen: check, verify, underwriting, finish.", done: "claimed",
  },
  {
    slug: "book-callback", module: "today", title: "Book a callback", minutes: 1, open: { href: "/app/callbacks", label: "Open Callbacks" },
    steps: [
      { say: "Click Add callback", find: "text:Add callback", then: "open" },
      { say: "Pick the lead and the time, then click Book callback", detail: "It comes back to you at that time, in the lead's own time zone.", find: "text:Book callback" },
    ],
    why: "A callback someone forgets is a sale lost.", whenDone: "The callback is on your calendar, and the dialer serves it on time.", done: "callback",
  },
  setup("today", "calling-windows", "Set your calling hours", 2, { href: "/app/settings#calling-windows", label: "Open Calling hours" }, "The dialer only serves leads inside these hours."),
  setup("today", "queue-sla", "Set how fast transfers must be claimed", 2, { href: "/app/settings#queue-sla", label: "Open Transfer claim times" }, "Unclaimed transfers warn, escalate and expire on these times."),
  setup("today", "outcomes", "Check where each call result moves a lead", 3, { href: "/app/settings#pipelines", label: "Open Pipelines" }, "Each outcome moves the lead to its stage."),

  // ── Sales ──
  {
    slug: "quote-client", module: "sales", title: "Quote a client", minutes: 3, open: { href: "/app/applications", label: "Open Applications" },
    steps: [
      { say: "Click the client to open their case", detail: "Or start one with New application, from the lead.", find: "table tbody tr:first-child td:nth-child(2) a", then: "open" },
      // `at`: a draft case in the demo agency (Wendell Okonkwo): the top cases are issued, and read-only there is no Add quote.
      { say: "Click Quote in the steps across the top", detail: "Only products you sell and carriers you're appointed with are offered.", find: "button[title='Quote']", then: "open", at: "/app/applications/ae3dd96f-6ec5-4f97-8b8d-f319b3958a9a?attempt=1" },
      { say: "Type the carrier's price, then click Add quote", detail: "Every quote stays on the case, and shows in Quotes.", at: "/app/applications/ae3dd96f-6ec5-4f97-8b8d-f319b3958a9a?attempt=1&step=quote", find: "button:has-text('Add quote')" },
    ],
    needs: ["products", "carriers"], why: "Quoting from the call keeps the client on the phone.", whenDone: "The quote is saved on the case and in Quotes.", done: "quoted",
  },
  {
    slug: "submit-application", module: "sales", title: "Submit an application", minutes: 10, open: { href: "/app/applications", label: "Open Applications" },
    steps: [
      { say: "Click the client to open their case", find: "table tbody tr:first-child td:nth-child(2)", then: "open" },
      { say: "Work through the steps: application, beneficiaries, payment, disclosures", detail: "Each step ticks when it's complete.", find: "text:Application" },
      { say: "Click Submit, then Capture submission", detail: "Record what was sent to the carrier, and when. The case moves to Waiting on the carrier.", find: "text:Submit" },
    ],
    needs: ["quote-client"], why: "Every case in one place, from quote to issued: nothing lost between carrier portals.",
    whenDone: "The case shows in Waiting on the carrier.", done: "submitted",
  },
  {
    slug: "follow-pending-case", module: "sales", title: "Follow a pending case", minutes: 2, open: { href: "/app/pending", label: "Open Waiting on the carrier" },
    steps: [
      { say: "Open Requirements, Counteroffers or Awaiting policy number", detail: "Each tab is a different kind of wait.", find: "text:Requirements" },
      { say: "Click Log a chase on the case", detail: "Or Chase everything overdue at once.", find: "text:Log a chase" },
    ],
    needs: ["submit-application"], why: "A requirement nobody chases is a case the carrier closes.", whenDone: "The chase is logged and the case shows when it was last chased.", done: "chased",
  },
  {
    slug: "draft-dates", module: "sales", title: "Check a draft date", minutes: 1, open: { href: "/app/applications?calculator=1", label: "Open the calculator" },
    steps: [
      { say: "Click Draft-date calculator for a quick check", detail: "It opens beside the list, and nothing in it is saved.", find: "text:Draft-date calculator", at: "/app/applications" },
      // The panel's open state is lost to the page's first render in the screenshot browser, so the picture shows the same
      // calculator on a draft case's Payment step (Wendell Okonkwo in the demo agency).
      { say: "Pick where their money comes from", detail: "The calculator asks the same on a case's Payment step. The draft day it recommends lines the first premium up with their pay day.", at: "/app/applications/ae3dd96f-6ec5-4f97-8b8d-f319b3958a9a?attempt=1&step=payment", find: "[aria-label='Where their money comes from']" },
    ],
    why: "A draft that comes out before pay day bounces, and the policy never goes in force.", whenDone: "Nothing to save: use the date on the application.",
  },

  // ── Book of business ──
  {
    slug: "import-book", module: "book", title: "Import your book", minutes: 10, open: { href: "/app/book-import", label: "Open Book import" },
    steps: [
      { say: "Click a carrier that says Bring it in", detail: "Each carrier row says where to find its policy report.", find: "[data-guide='book-carriers'] tbody tr:has-text('Bring it in') td:first-child button", then: "open" },
      { say: "Drop its policy report in, then click Upload", detail: "Skip a carrier you don't have a file for.", find: "guide:book-upload" },
    ],
    needs: ["carriers"], why: "Retention and commission checks work from your in-force book.", whenDone: "Its policies are in Policies, each with its status.", done: "book",
  },
  {
    slug: "find-policy", module: "book", title: "Find a policy", minutes: 1, open: { href: "/app/policies", label: "Open Policies" },
    steps: [
      { say: "Search by policy number, client or agent", find: "input[placeholder*='Policy, client']" },
      { say: "Click the policy number to open it", detail: "Its premium, commission and every change on one page.", find: "table tbody tr:first-child td:first-child a" },
    ],
    why: "One place for a policy, not one carrier portal each.", whenDone: "Nothing to save.",
  },
  {
    slug: "read-ledger", module: "book", title: "Read the commission ledger", minutes: 2, open: { href: "/app/ledger", label: "Open Commission ledger" },
    steps: [
      { say: "Lines: every dollar, per policy", find: "text:Lines" },
      { say: "Open Carrier accounts for each carrier's balance", find: "text:Carrier accounts" },
      { say: "Open Expected for what should still come", find: "text:Expected" },
    ],
    needs: ["statement"], why: "What you were paid and what you're still owed, per policy.", whenDone: "Nothing to save.",
  },

  // ── Carrier sync ──
  {
    slug: "map-agent-codes", module: "carrier-sync", title: "Map agent codes", minutes: 3, open: { href: "/app/book-setup/agent-codes", label: "Open Agent codes" },
    steps: [
      { say: "Click Map one by one", detail: "Codes the carriers' files used that nobody is mapped to.", find: "text:Map one by one", then: "open" },
      { say: "Pick the person, then click Map and next", find: "text:Map and next" },
    ],
    needs: ["statement"], why: "An unknown agent code means commission nobody is credited for.", whenDone: "Every file from now on credits that code to that person.", done: "agentCodes",
  },
  {
    slug: "carrier-terms", module: "carrier-sync", title: "Set carrier terms", minutes: 3, open: { href: "/app/book-setup/carrier-rules", label: "Open Carrier terms" },
    steps: [
      { say: "Click Set the next window", detail: "The carrier's chargeback and grace windows.", find: "text:Set the next window", then: "open" },
      { say: "Fill in the window, then click Save", find: "text:Save" },
    ],
    needs: ["carriers"], why: "Retention and chargeback checks need each carrier's own windows.", whenDone: "The carrier's windows show in Carrier terms.", done: "carrierTerms",
  },
  {
    slug: "clear-needs-you", module: "carrier-sync", title: "Clear Needs you", minutes: 5, open: { href: "/app/needs-you", label: "Open Needs you" },
    steps: [
      { say: "Click Review the oldest", detail: "Only what the files couldn't place on their own.", find: "text:Review the oldest", then: "open" },
      { say: "Pick the answer, or Skip", detail: "Each answer teaches the next file.", find: "text:Skip" },
    ],
    needs: ["map-agent-codes"], why: "A few minutes a month here keeps every file reading itself.", whenDone: "The item moves to Closed.", done: "needsYou",
  },

  // ── Commissions ──
  setup("commissions", "statement", "Upload a carrier statement", 10, { href: "/app/statements?import=1", label: "Open Statements" }, "Every line is matched to a policy, and anything wrong becomes a pay issue.", ["carriers"]),
  {
    slug: "settle-pay-issue", module: "commissions", title: "Settle a pay issue", minutes: 4, open: { href: "/app/discrepancies", label: "Open Pay issues" },
    steps: [
      { say: "Click Work the largest", detail: "Missing advances, short pays and wrong chargebacks, biggest first.", find: "text:Work the largest", then: "open" },
      { say: "Click Decide", detail: "One place for every answer: put it on a letter, or settle it here.", find: "button:text-is('Decide')", then: "open" },
      { say: "Pick what happened, then click Save", detail: "A letter claims it from the carrier. Paid outside the statement, write it off or dismiss settles it here.", find: "[role='dialog'] button:has-text('Save')" },
    ],
    needs: ["statement"], why: "Carriers short-pay and charge back wrongly. Unclaimed, that money is gone.", whenDone: "The pay issue moves to Letters out, Settled or Closed.", done: "payIssue",
  },
  {
    slug: "pay-producers", module: "commissions", title: "Pay your producers", minutes: 5, open: { href: "/app/producer-payouts", label: "Open Team payouts" },
    steps: [
      { say: "Open Pay plans to check how each person is paid", find: "text:Pay plans" },
      { say: "On the month's tab, check each person's pay", detail: "Only matched statement lines count. What happens to it says if anything is taken back.", at: "/app/producer-payouts", find: "main table" },
      { say: "Click Confirm and mark paid", detail: "Set the paid-on date, then confirm.", find: "text:Confirm and mark paid" },
    ],
    needs: ["statement"], why: "Pay from what really came in, so there are no pay disputes.", whenDone: "The run shows in Runs, and each producer sees it in My pay.", done: "producerPaid",
  },
  {
    slug: "pay-partners", module: "commissions", title: "Pay your partners", minutes: 5, open: { href: "/app/payouts", label: "Open Partner payouts" },
    steps: [
      { say: "Open Rulebooks, then click the partner", detail: "How you pay each partner: per transfer or per submitted application.", at: "/app/payouts?view=rulebooks", find: "a[href*='/app/payouts/rulebook/']", then: "open" },
      { say: "Set how you pay them, then click Save rulebook", detail: "The amount, how often, the chargeback policy and who gets paid.", at: "/app/payouts/rulebook/97b4adf7-06f5-40f3-a952-d7c09d2ef6cb", find: "text:Save rulebook" },
      { say: "Click Run payouts", detail: "One payout per partner for the period, from their ledger. Nothing is paid twice.", at: "/app/payouts", find: "text:Run payouts" },
      { say: "Click a payout in To review to open it", detail: "Drafts wait here until you publish them.", at: "/app/payouts?status=review", find: "main table tbody tr:first-child td:nth-child(2)", then: "open" },
      // `at`: the demo agency's top draft (RUN-6A0CC0E6); the row opens it client-side, often after the click has stopped waiting.
      { say: "Check each line, then click Publish & share", detail: "The PDF is stored, and your partner sees it in their portal.", at: "/app/payouts/6a0cc0e6-e690-441d-b807-c23ca9f3a22f?from=review", find: "text:Publish & share" },
      { say: "After you pay them, open To pay and click Mark paid", detail: "Published payouts wait in To pay. Mark paid stamps every line on it paid.", at: "/app/payouts?status=pay", find: "text:To pay" },
    ],
    needs: ["lead-sources"], why: "Paying partners from a spreadsheet pays twice or misses what converted.", whenDone: "The payout shows in Paid, and in the partner's portal.", done: "partnerPaid",
  },
  {
    slug: "commission-splits", module: "commissions", title: "Set a commission split", minutes: 2, open: { href: "/app/commission-splits", label: "Open Commission splits" },
    steps: [
      { say: "Click New split", find: "text:New split", then: "open" },
      { say: "Pick the policy and each person's share, then click Save split", find: "text:Save split" },
    ],
    needs: ["team"], why: "Two people on one sale both get credited, the same way every month.", whenDone: "The split shows under Active and applies to the next statement.", done: "split",
  },

  // ── Accounting ──
  setup("accounting", "accounting", "Set up accounting", 2, { href: "/app/accounting-settings?tab=bills", label: "Open Accounting settings" }, "Vendor bills off by more than your tolerance are flagged."),
  {
    slug: "vendor-bill", module: "accounting", title: "Check a vendor bill", minutes: 3, open: { href: "/app/vendor-bills", label: "Open Vendor bills" },
    steps: [
      { say: "Click Enter a bill", find: "text:Enter a bill", then: "open" },
      { say: "Fill it in, then click Save bill", detail: "Insurvas checks it against the leads you actually got.", find: "text:Save bill" },
      { say: "If it matches, click Approve", detail: "A bill that doesn't match goes to Disputed.", at: "/app/vendor-bills", find: "text:Approve" },
    ],
    needs: ["campaign"], why: "Vendors bill for leads you never got. Checked, you pay only for what arrived.", whenDone: "The bill moves to To pay, then Paid.", done: "billChecked",
  },
  {
    slug: "bank-deposits", module: "accounting", title: "Match bank deposits", minutes: 5, open: { href: "/app/bank", label: "Open Bank deposits" },
    steps: [
      { say: "Open Accounts: add your bank account, then import its CSV", find: "text:Accounts" },
      { say: "Open Deposits to see each deposit beside the statement it pays", find: "text:Deposits", then: "open" },
      { say: "On Payments, click Review on any that's short", detail: "Missing money and bad math are flagged, worst first.", at: "/app/bank", find: "text:Review" },
    ],
    needs: ["statement"], why: "Proves each statement was really paid into the bank.", whenDone: "The deposit shows as matched to its statement.", done: "bankMatched",
  },
  {
    slug: "add-expense", module: "accounting", title: "Add an expense", minutes: 2, open: { href: "/app/expenses", label: "Open Expenses" },
    steps: [
      { say: "Click Add an expense", find: "text:Add an expense", then: "open" },
      { say: "Fill it in, then click Add expense", detail: "For a cost that comes back every month the button reads Set up monthly bill.", find: "button[form='expense-form']" },
    ],
    why: "Profit is only real when every cost is in it.", whenDone: "The expense is in its month, and in your P&L.", done: "expense",
  },
  {
    slug: "read-pnl", module: "accounting", title: "Read your P&L", minutes: 2, open: { href: "/app/pnl", label: "Open Profit & loss" },
    steps: [
      { say: "Read the month's statement", find: "text:Statement" },
      { say: "Open Last six months for the trend", find: "text:Last six months" },
    ],
    needs: ["add-expense", "bank-deposits"], why: "Your real profit, from statements, bills and expenses Insurvas already has.", whenDone: "Nothing to save.",
  },

  // ── Retention ──
  setup("retention", "retention", "Set your retention rules", 2, { href: "/app/retention-settings?tab=radar", label: "Open Retention settings" }, "At-risk policies reach the save queue on your rules."),
  {
    slug: "work-save-case", module: "retention", title: "Work a save case", minutes: 5, open: { href: "/app/retention", label: "Open Retention" },
    steps: [
      { say: "Click Work the next case", detail: "The best save first: payment problems, pending lapses, reinstatements.", find: "text:Work the next case", then: "open" },
      // `at`: the case Work the next case opens in the demo agency; the click often outruns the page.
      { say: "Call them, then click Log the call", detail: "Fix the payment or re-date the draft while you're on.", at: "/app/retention/7a519112-09be-44c1-ae46-825759f99e5e?tab=do", find: "text:Log the call" },
    ],
    needs: ["import-book"], why: "A lapse in year one means the carrier takes the advance back.", whenDone: "The call is on the case, and it moves on or closes.", done: "saveCase",
  },
  {
    slug: "win-back", module: "retention", title: "Win back a lapsed policy", minutes: 3, open: { href: "/app/reinstatement", label: "Open Win-back" },
    steps: [{ say: "Click Open the Win-back list", detail: "Lapsed clients worth one more call, scrubbed first.", find: "text:Open the Win-back list" }],
    needs: ["work-save-case"], why: "A lost client who already said yes once is the cheapest sale you'll make.", whenDone: "They're back in the dialer as a list.",
  },

  // ── Compliance ──
  setup("compliance", "disclosures", "Check your disclosures", 3, { href: "/app/settings#sales-disclosures", label: "Open Disclosures" }, "The disclosure shows on the call, and the reading is recorded."),
  setup("compliance", "compliance", "Set your compliance rules", 2, { href: "/app/compliance/settings#retention", label: "Open Compliance settings" }, "Records are kept and deleted on these rules."),
  {
    slug: "find-consent", module: "compliance", title: "Find a lead's consent", minutes: 1, open: { href: "/app/consent", label: "Open Consent locker" },
    steps: [
      { say: "Search for the lead", find: "label:Search leads" },
      { say: "Click Open, or Add proof, on the lead's row", detail: "Its consent record: where and when they agreed, and the page they agreed on. Add proof means none is on file yet.", find: "main table tbody tr:first-child td:last-child a" },
    ],
    why: "When someone says they never agreed, the proof is one search away.", whenDone: "Nothing to save. Export it if you need to send it.",
  },
  {
    slug: "deletion-request", module: "compliance", title: "Handle a deletion request", minutes: 4, open: { href: "/app/deletion-requests", label: "Open Deletion requests" },
    steps: [
      { say: "Click Log a request", find: "text:Log a request", then: "open" },
      { say: "Fill it in, then click Log request", detail: "The deadline starts now.", find: "text:Log request" },
      { say: "Click a request whose next step is Verify", detail: "Requests waiting on proof of who's asking.", at: "/app/deletion-requests?queue=all", find: "main table tbody tr:has-text('Verifying') td:first-child a", then: "open" },
      // `at`: the demo agency's requests (Gloria Benton verifying, Geneva Ivey past her hold); a record page often loads slower than the click waits.
      { say: "Click Verify who it is", detail: "Record how you confirmed them. A short hold starts, and can still be cancelled.", at: "/app/deletion-requests/b314cd70-9b25-4ae9-8482-2d91af0edd47", find: "text:Verify who it is" },
      { say: "When the hold is over, open the request", detail: "Ready to delete lists the ones whose hold is over.", at: "/app/deletion-requests?queue=ready", find: "main table tbody tr:first-child td:first-child a", then: "open" },
      { say: "Click Delete now, then download the certificate", detail: "The do-not-call entry is kept, so they are never called again.", at: "/app/deletion-requests/827bb1f4-4b94-4730-b6c7-f1e7a0c5d13b", find: "text:Delete now" },
    ],
    why: "A missed deletion deadline is a fine.", whenDone: "The request shows under Done, with its certificate.", done: "deletion",
  },
  {
    slug: "evidence-report", module: "compliance", title: "Pull an evidence report", minutes: 2, open: { href: "/app/evidence-report", label: "Open Evidence report" },
    steps: [
      { say: "Click Run a report", find: "text:Run a report", then: "open" },
      { say: "Enter the phone number or lead, then click Run report", detail: "Consent, where the lead came from, every call: one PDF.", find: "text:Run report" },
    ],
    why: "When a claim arrives, the proof must already exist.", whenDone: "The report is under Reports run. Download its PDF.", done: "evidence",
  },

  // ── Reports ──
  {
    slug: "true-cpa", module: "reports", title: "Find your true cost per sale", minutes: 2, open: { href: "/app/true-cpa", label: "Open True CPA" },
    steps: [
      { say: "Read each vendor's true cost per sale", detail: "Every dollar paid for its leads, over the sales they made.", find: "text:Vendors" },
      { say: "Open Compare to put two side by side", find: "text:Compare" },
    ],
    needs: ["vendor-bill"], why: "Decide what to buy next on cost per sale, not cost per lead.", whenDone: "Nothing to save.",
  },
  {
    slug: "producer-scorecards", module: "reports", title: "Read producer scorecards", minutes: 2, open: { href: "/app/producer-scorecards", label: "Open Scorecards" },
    steps: [{ say: "Open a producer's scorecard", detail: "Activity, placement and persistency, against the agency.", find: "text:Open as a table" }],
    why: "Who needs coaching, from numbers, not feel.", whenDone: "Nothing to save.",
  },

  // ── Partners ──
  setup("partners", "lead-sources", "Add a publisher", 2, { href: "/app/publishers", label: "Open Publishers" }, "They get a portal, and their leads and transfers are tracked."),
  {
    slug: "partner-chat", module: "partners", title: "Chat with a partner", minutes: 1, open: { href: "/app/partner-chat", label: "Open Partner chat" },
    steps: [
      { say: "Click New", find: "[aria-label='New conversation']", then: "open" },
      { say: "Pick the partner, then click Start conversation", find: "text:Start conversation" },
    ],
    needs: ["lead-sources"], why: "Partner deals in one channel, not texts and email.", whenDone: "The conversation is in Partner chat, for both of you.", done: "partnerChat",
  },
  {
    slug: "partner-quality", module: "partners", title: "Read partner quality", minutes: 2, open: { href: "/app/partner-quality", label: "Open Partner quality" },
    steps: [{ say: "Search for the partner, then open them", detail: "Contact, sale and persistency rates from what they sent.", find: "label:Search partners" }],
    needs: ["lead-sources"], why: "Pay and keep partners on what converts.", whenDone: "Nothing to save.",
  },

  // ── Home ──
  {
    slug: "start-the-day", module: "home", title: "Start your day from Home", minutes: 1, open: { href: "/app/dashboard", label: "Open Home" },
    steps: [{ say: "Start with Needs you, the figures across the top", detail: "Each one opens the list behind it. Then Today, your numbers and your shortcuts.", find: "section[aria-label='Needs you']" }],
    why: "What to do today, without hunting.", whenDone: "Nothing to save.",
  },
  {
    slug: "agency-dashboard", module: "home", title: "Check the agency's health", minutes: 2, open: { href: "/app/agency", label: "Open the agency dashboard" },
    steps: [{ say: "Read the five figures, then click Compare", detail: "Two periods or two people side by side.", find: "text:Compare" }],
    why: "The agency on one screen each week.", whenDone: "Nothing to save.",
  },

  // ── Your agency ──
  setup("agency", "carriers", "Add your carriers", 5, { href: "/app/settings#carriers/carriers-setup", label: "Open Carriers" }, "Quotes offer them, and statements match to them."),
  setup("agency", "states", "Add your states", 3, { href: "/app/settings#carriers/carriers-setup", label: "Open Carriers" }, "Routing and quotes follow the states you're appointed in.", ["carriers"]),
  setup("agency", "products", "Choose your products", 1, { href: "/app/settings#products", label: "Open Products" }, "Imports, campaigns and quotes offer only these."),
  setup("agency", "team", "Invite your team", 2, { href: "/app/settings#team-access", label: "Open Team & access" }, "They get an invite, and appear in routing and pay."),
  setup("agency", "hierarchy", "Set your hierarchy", 3, { href: "/app/hierarchy", label: "Open Hierarchy" }, "Overrides and producer pay follow it.", ["team"]),
  setup("agency", "phone", "Connect your phone number", 1, { href: "/app/settings#business-identity/identity-partner-support", label: "Open Business identity" }, "Partners see it in their portal and messages."),
];

export function docTask(slug: string): DocTask | null {
  return DOC_TASKS.find((task) => task.slug === slug) ?? null;
}

export function tasksFor(module: string): DocTask[] {
  return DOC_TASKS.filter((task) => task.module === module);
}
