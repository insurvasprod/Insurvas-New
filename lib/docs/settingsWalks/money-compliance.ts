import type { SettingsWalk } from "../settingsWalks.ts";

/** A setting's whole row on the money & compliance boards (setting-kit SettingRow: its name is a button titled with the label). */
const row = (label: string) => `tr:has(button[title="${label}"])`;
const tab = (label: string) => `[role="tab"]:has-text("${label}")`;

/** Settings walks for this group of Settings pages; see lib/docs/settingsWalks.ts. */
export const WALKS: Record<string, SettingsWalk> = {
  accounting: {
    outcome: "Your books count money the way your accountant wants, with bank matching, bills, partner payouts, producer pay and the 1099 threshold set.",
    minutes: 10,
    steps: [
      { say: "Open the Books tab", detail: "Each tab is one list of settings. A row shows its value now and which pages use it.", find: tab("Books"), then: "open" },
      { say: "Set Your financial year starts", detail: "Year-to-date figures and the tax year's summaries start in this month.", find: row("Your financial year starts") },
      { say: "Click Count money when", detail: "This picks earned (accrual) or moves (cash) for every P&L, tax summary and producer statement. Ask your accountant which.", find: row("Count money when"), then: "open" },
      { say: "Pick a basis in the sheet", detail: "The sheet changes this one setting and lists what it affects. Nothing is saved until you click Save this setting.", find: '[role="radiogroup"][aria-label="P&L basis"]' },
      { say: "Open the Bank tab", detail: "These settings decide how Bank deposits looks for each carrier payment in your bank file.", at: "/app/accounting-settings?tab=bank", find: tab("Bank"), then: "open" },
      { say: "Set Look for the deposit up to", detail: "Days after the carrier's payment date. Past this with nothing in the bank, the payment is flagged as missing money.", find: row("Look for the deposit up to") },
      { say: "Add your Bank accounts", detail: "The accounts your carrier money lands in. Bank deposits matches each bank file against them.", find: 'tr:has-text("Bank accounts")' },
      { say: "Open the Bills & expenses tab", detail: "Vendor bills are checked against the leads you counted.", find: tab("Bills & expenses"), then: "open" },
      { say: "Set Flag a bill that differs by more than", detail: "A vendor bill further off than this shows as a difference on Vendor bills, so you can query it before paying.", find: row("Flag a bill that differs from your count by more than") },
      { say: "Check Expense groups on the P&L", detail: "Each expense category counts as acquisition or overhead. Only acquisition costs go into cost per policy.", find: row("Expense groups on the P&L") },
      { say: "Open the Partner payouts tab", detail: "How payout runs to your partners are drafted. Each partner's own terms are kept on Partners.", find: tab("Partner payouts"), then: "open" },
      { say: "Set When a payout run is ready", detail: "Wait for my review keeps a new run in draft for you to check. Publish to the partner shows it to them at once.", find: row("When a payout run is ready") },
      { say: "Set Pay partners", detail: "How often a partner payout run is drafted, and how many days after the period ends.", find: row("Pay partners") },
      { say: "Open the Producer pay tab", detail: "What producers see and how their balances are handled. Commission levels are on the Rate card.", find: tab("Producer pay"), then: "open" },
      { say: "Set When someone's balance goes below zero", detail: "This is the choice Run payroll starts with for anyone who owes: carry it, take a share each month, or let it go.", find: row("When someone's balance goes below zero") },
      { say: "Set Default split for a new producer", detail: "It's filled in when you add a producer, so you don't type it each time. A producer's own split always wins.", find: row("Default split for a new producer") },
      { say: "Open the Tax tab", detail: "Who appears on the 1099 summary and who may see tax IDs.", find: tab("Tax"), then: "open" },
      { say: "Check the 1099 threshold", detail: "Payees paid this much or more in the year appear on the 1099 summary. The IRS figure moves, so check it each year.", find: row("1099 threshold") },
    ],
  },
  retention: {
    outcome: "Retention cases open on the carrier facts you want, go to the right people, and win-back and radar timings suit your book.",
    minutes: 10,
    steps: [
      { say: "Open the Ladder tab", detail: "The ladder lists the facts in carrier files that open a retention case, and which step each one goes on.", find: tab("Ladder"), then: "open" },
      { say: "Click First payment missed", detail: "Each fact opens its own sheet. The row also shows how many cases are open for that reason now.", find: row("First payment missed"), then: "open" },
      { say: "Choose On or Off under Counts", detail: "On puts the policy on the ladder when a carrier file shows this fact. Off opens nothing for it. A change re-runs the ladder at once.", find: '[role="radiogroup"][aria-label="Counts"]' },
      { say: "Set A deadline is urgent within", detail: "A payment problem this close to its deadline moves up to Pending lapse and to the top of Cases.", at: "/app/retention-settings/ladder", find: row("A deadline is urgent within") },
      { say: "Set Unreachable after", detail: "After this many calls in a row that reach nobody, the case moves to the Unreachable step.", find: row("Unreachable after") },
      { say: "Open the Who works it tab", detail: "Who gets each queue's cards. Who holds the retention role is set in Team & access.", find: tab("Who works it"), then: "open" },
      { say: "Pick who owns each queue", detail: "Retention reps, the writing agent or you. A role with nobody in it falls back, so no card is left without an owner.", find: 'tr:has(button[title^="Who owns"])' },
      { say: "Set Share work between reps", detail: "Round-robin takes turns, By carrier gives each carrier to one rep, By exposure sends the biggest risk to your first rep.", find: "#assignment" },
      { say: "Open the Requests tab", detail: "Servicing requests, the paper bill to bank draft campaign and the reinstatement countdown.", find: tab("Requests"), then: "open" },
      { say: "Set Fail a servicing request", detail: "If a carrier file still disagrees this many days after a change was due, the request is marked failed so someone follows it up.", find: "#servicing" },
      { say: "Open the Win-back tab", detail: "How long a lapsed client rests before they come back to you as a lead.", find: tab("Win-back"), then: "open" },
      { say: "Set the wait for each lapse reason", detail: "Each reason has its own wait. Someone who could not afford it waits at least 180 days.", find: "#winback" },
      { say: "Open the Radar tab", detail: "How the chargeback radar scores in-force policies and fills the save queue.", find: tab("Radar"), then: "open" },
      { say: "Choose what The save queue takes", detail: "Decides which scored policies reach the save queue. The sheet shows how many cards it would hold today.", find: "#thresholds" },
      { say: "Check the Risk bands", detail: "Where a risk score out of 100 turns medium, high and critical on the radar and the save queue.", find: row("Risk bands") },
      { say: "Look over the Scoring weights", detail: "How much each of the seven signals counts in a risk score. The sheet shows what a change does to your book before you save.", find: "#weights" },
      { say: "Set Queue: rest, most shown, sort", detail: "How long a worked card rests, how many cards show and what comes first, so reps work the biggest risk.", find: "#queue" },
      { say: "Decide on the Holdout", detail: "It holds back a random share of the save queue, so Results can show whether working it saves policies. It stays off until you read what it does.", find: "#holdout" },
    ],
  },
  compliance: {
    outcome: "Complaint deadlines, record keeping, holds, deletion rules and the transfer gate are set the way your counsel wants.",
    minutes: 12,
    steps: [
      { say: "Open the Start here tab", detail: "The three decisions to make first. Each row opens a sheet for that one setting.", find: tab("Start here") },
      { say: "Choose If a transfer has no consent on file", detail: "Accept and flag it lets the call through and counts it on the dashboard. Block the transfer refuses it before it reaches you.", find: row("If a transfer has no consent on file") },
      { say: "Leave Delete records on a schedule off for now", detail: "Turn it on only once your record rules are set. A dry run is emailed before every live run, and held records are never deleted.", find: row("Delete records on a schedule") },
      { say: "Open the Complaints tab", detail: "Every regulator's response deadline. Licensed states with no deadline show first as Not set.", find: tab("Complaints"), then: "open" },
      { say: "Click Add a regulator", detail: "Add each state you are licensed in, and the FTC. A regulator with no deadline gets no countdown.", find: "text:Add a regulator", then: "open" },
      { say: "Pick the regulator and enter Days to respond", detail: "New complaints from this regulator count down from it. Open complaints keep their due dates.", find: "label:Days to respond" },
      { say: "Open the Records tab", detail: "How long each type of record is kept, and the scheduled purge.", at: "/app/compliance/settings#retention", find: tab("Records"), then: "open" },
      { say: "Check how long each record type is kept", detail: "Click a type to add your own rule, for all states or one. A type with no rule is never deleted. These periods are a start, not legal advice.", find: "#retention" },
      { say: "Choose who gets the dry-run email", detail: "Before any live purge, these people get the list of what would be deleted, so they can stop it.", find: row("Email the dry-run summary to") },
      { say: "Open the Holds & deletion tab", detail: "Nothing under a legal hold is deleted. Complaints and commission disputes place a hold by themselves.", find: tab("Holds & deletion"), then: "open" },
      { say: "Tick the Ways to verify who is asking", detail: "A deletion request none of these can verify is rejected. Keep at least one.", find: row("Ways to verify who is asking") },
      { say: "Set Who may verify and perform a deletion", detail: "The owner always may. Let producers too only if they handle deletion requests.", find: row("Who may verify and perform a deletion") },
      { say: "Click New hold", detail: "Place a hold by hand when litigation or a regulator inquiry needs records kept.", find: "text:New hold", then: "open" },
      { say: "Fill in what it covers, why, and a note", detail: "A hold covers a phone number, a policy number or everything. The purge skips what it covers until you release it.", find: '[role="radiogroup"][aria-label="Covers"]' },
      { say: "Open the Gate & reports tab", detail: "The checks run on every transfer from a partner, the evidence report and the compliance dashboard.", at: "/app/compliance/settings#gate", find: tab("Gate & reports"), then: "open" },
      { say: "Check the Gap checks that run", detail: "Every evidence report and the monthly gap scan run the ticked checks. A check that is off shows as off, never as passed.", find: row("Gap checks that run") },
    ],
  },
};
