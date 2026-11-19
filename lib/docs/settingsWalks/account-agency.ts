import type { SettingsWalk } from "../settingsWalks.ts";

/** Settings walks for this group of Settings pages; see lib/docs/settingsWalks.ts. */
// A step that must start on a fresh page after a sheet was opened uses its own `?s=` query: a hash-only change
// would leave the sheet open.
export const WALKS: Record<string, SettingsWalk> = {
  "my-profile": {
    outcome: "Your name, phone, time zone, languages and licence numbers are right, two-step is on, and alerts reach you where you want them.",
    minutes: 5,
    steps: [
      { say: "Check your Full name", detail: "Clients and teammates see this name on calls, letters and the team list.", find: "#profile-name" },
      { say: "Add your Mobile phone", detail: "Your own number, not the agency line. The agency's main line is set on Business identity.", find: "#profile-phone" },
      { say: "Set Your time zone", detail: "Times show in this zone for you only. Calling hours still follow each customer's state.", find: "#profile-timezone" },
      { say: "Pick the Languages you speak with clients", detail: "Callers who speak a language you pick are offered to you first.", find: "#profile-languages" },
      { say: "Fill in Your NPN and licence numbers", detail: "They are stored on your producer record, and carriers ask for them on applications.", find: "#profile-npn" },
      { say: "Turn on Two-step verification", detail: "After this you need a code from an app each time you sign in. Some roles need it before Social Security and bank numbers can be shown.", find: "#security-two-factor" },
      { say: "Check Where you're signed in", detail: "See devices lists every device on your account. Sign out any you don't know.", find: "#security-sessions" },
      { say: "Set Quiet hours", detail: "Email and browser alerts wait until quiet hours end. Always on alerts still come through.", find: "#notify-quiet-hours" },
      { say: "Choose where each alert reaches you", detail: "Switch In app, Browser or Email on for each alert, and pick how busy emails arrive. Alerts marked Always on can't be switched off.", find: "#my-profile-alerts table" },
      { say: "Press Save Changes at the foot of the card", detail: "One bar saves your profile, photo and alerts together. Email, password and two-step are confirmed in their own windows.", find: "text:Save Changes" },
    ],
  },

  "plan-and-billing": {
    outcome: "You know your plan, what you use of each limit, your invoices and how you pay.",
    minutes: 3,
    steps: [
      { say: "Check your plan and its limits", detail: "Each meter shows what you use of a limit and when it resets. You get a warning before anything is cut off.", find: "#billing-limits" },
      { say: "Compare plans when you need more", detail: "Compare plans shows your use beside each plan's limits. Nothing changes until you confirm a move.", find: "#billing-plan" },
      { say: "Look over your Invoices", detail: "Every invoice with its date, period, amount and status. An unpaid one has a Pay button.", find: "#billing-invoices" },
      { say: "Click View on an invoice", detail: "The invoice opens on the right with its lines and total, and a PDF you can download.", find: "#billing-invoices button:has-text(\"View\")", then: "open" },
      { say: "Download the PDF for your records", detail: "Opens the printable invoice in a new tab, to print or save.", find: "text:Download PDF" },
      { say: "Check how you pay", detail: "Payment shows your next charge and how you pay. With a card on file, Update card opens Whop's page; your card never passes through Insurvas.", find: "#billing-card", at: "/app/settings?s=6#billing" },
      { say: "Pause or cancel… is here if you need it", detail: "It opens steps that explain what still works before anything changes. Pausing keeps your records.", find: "#billing-cancel" },
    ],
  },

  "business-identity": {
    outcome: "Every letter, statement and export carries your agency's right names, numbers, address, phone and logo.",
    minutes: 6,
    steps: [
      { say: "Enter your Trading name", detail: "The name printed on client documents, such as the welcome pack and payout statement.", find: "#identity-trading-name" },
      { say: "Enter your Legal name", detail: "Used on tax forms and carrier contracts. It is required.", find: "#identity-legal-name" },
      { say: "Add the agency's NPN", detail: "The dispute letter and DOI complaint response need it.", find: "#identity-npn" },
      { say: "Add your Tax ID", detail: "It is stored encrypted and shown masked. The tax export needs it.", find: "#identity-tax-id" },
      { say: "Set the Business time zone", detail: "How times show for your team and when daily summaries arrive. Calling hours follow each customer's state.", find: "#identity-timezone" },
      { say: "Fill in the business address", detail: "Printed on letters and statements. The payout statement needs the full address.", find: "#identity-address-line1" },
      { say: "Add the Business phone", detail: "The agency's main line, printed on the welcome pack. Your own number is on My profile.", find: "#identity-phone" },
      { say: "Upload your logo", detail: "A PNG or JPEG up to 512 KB, printed at the head of every letter. It saves as soon as you pick it.", find: "#identity-logo" },
      { say: "Add the partner support contact", detail: "The email and phone partners see in their portal. Leave them blank to hide them.", find: "#identity-partner-support" },
      { say: "Click Preview a letter", detail: "Shows how a letter's head and foot print with what is on screen. Then press Save changes in the bar that appears at the foot of the card once you change a field: it saves every field at once.", find: "text:Preview a letter" },
    ],
  },

  "team-access": {
    outcome: "Everyone who works with you is invited, with the right role and the states they're licensed in.",
    minutes: 5,
    steps: [
      { say: "Click Invite someone", detail: "Opens the invite on the right. It is greyed out when every seat on your plan is in use.", find: "guide:team-invite", then: "open" },
      { say: "Enter their name and work email", detail: "The invitation goes to this email. Their name shows across Insurvas.", find: "label:First and last name" },
      { say: "Pick What they'll do", detail: "Agent, Setter or Intake. More roles adds Admin, Accounting, Retention and Owner. The footer says which seat it uses.", find: "[role=\"radiogroup\"][aria-label=\"Role\"]" },
      { say: "Add the states they're Licensed in", detail: "Leads are only given to them in these states. You can add them after they accept.", find: "text:Add a state" },
      { say: "Click a person to open their sheet", detail: "Their sheet holds their role, licences and open work.", find: "tr[aria-label^=\"Open \"]:has-text(\"Agent\")", then: "open", at: "/app/settings?s=5#team-access" },
      { say: "Check their Access", detail: "Their role sets what they can do. A change applies on their next page.", find: "[role=\"radiogroup\"][aria-label=\"Role\"]" },
      { say: "Keep their Licensed in states up to date", detail: "Click a state to set when the licence ends. After that date they get no leads there.", find: "text:Add a state" },
      { say: "Open the Invites tab", detail: "Invitations not accepted yet. Each one holds a seat until it is accepted or revoked.", find: "text:Invites", then: "open", at: "/app/settings?s=8#team-access" },
      { say: "Open the Deactivated tab", detail: "People who can no longer sign in. Their policies and commission history stay, and you can reactivate them.", find: "text:Deactivated", then: "open" },
    ],
  },

  products: {
    outcome: "Only the products your agency sells are switched on, and each one has what it needs to quote.",
    minutes: 4,
    steps: [
      { say: "Stay on the In your plan tab", detail: "These are the products your plan includes. Leads, partners, forms and quotes offer only the ones you sell.", find: "text:In your plan" },
      { say: "Turn Sell on for each product you sell", detail: "Turning one on saves at once with Undo. Turning one off asks first. Nothing is deleted.", find: "#products-list [role=\"switch\"]" },
      { say: "Check What it needs", detail: "Form, carriers, health questions and quote inputs, in call order. A missing one is a + link to the page that sets it up.", find: "#products-list th:has-text(\"What it needs\")" },
      { say: "Click a product to open its sheet", detail: "The sheet shows what it needs before agents can quote it, and who may send it.", find: "#products-list tbody td:nth-child(2) button", then: "open" },
      { say: "Finish what Ready to quote lists", detail: "Each line opens the Settings page that sets it up.", find: ":text-is(\"Ready to quote\")" },
      { say: "Open the Not in your plan tab", detail: "Products your plan doesn't include, and the plan that adds each one. Nothing here changes your plan.", find: "text:Not in your plan", then: "open", at: "/app/settings?s=6#products" },
      { say: "See which plan adds each one", detail: "Added by names the plan. See plans explains what else comes with it, without changing anything.", find: "#products-panel" },
    ],
  },

  carriers: {
    outcome: "Your carriers are added with their contract level and writing number, and you're appointed in the right states.",
    minutes: 8,
    steps: [
      { say: "Click Add carrier", detail: "Three short steps: the carrier, the contract, then states and writers. Nothing is added until the last step.", find: "text:Add carrier", then: "open" },
      { say: "Find your carrier in the library", detail: "Pick the carrier you're contracted with. If it isn't listed, Insurvas can add it.", find: "[role=\"dialog\"]" },
      { say: "Click a carrier to open its sheet", detail: "Everything about one carrier in one place: contract, products, states and its site.", find: "tr[aria-label^=\"Open \"]", then: "open", at: "/app/settings?s=3#carriers" },
      { say: "Set the First-year commission", detail: "What the carrier pays your agency in year one, for example 110. Commission figures need it.", find: "label:First-year commission" },
      { say: "Tick the Products you sell", detail: "Only ticked products show when agents quote with this carrier.", find: ":text(\"Products you sell\")" },
      { say: "Click Open the field map", detail: "The field map tells the browser extension where each answer goes on the carrier's application.", find: "text:Open the field map", then: "open" },
      { say: "Check each carrier's map badge", detail: "Ready means the extension fills that carrier's application. No map or Draft means agents type it by hand until a map is published.", find: "[role=\"dialog\"]" },
      { say: "Open the States tab", detail: "States down, carriers across. A tick means you're appointed there, with how many writers are licensed.", find: "[role=\"tab\"]:has-text(\"States\")", then: "open", at: "/app/settings?s=8#carriers" },
      { say: "Click a cell to add or end an appointment", detail: "It shows the carrier in that state. Adding also records your agency licence there.", find: "main table td button" },
    ],
  },
};
