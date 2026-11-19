import type { SettingsWalk } from "../settingsWalks.ts";

/** A Sales process header tab, by its label (the tab bar, not the Overview's "Open …" buttons). */
const spTab = (label: string) => `[role="tablist"][aria-label="Sales process"] [role="tab"]:has-text("${label}")`;

/** Settings walks for this group of Settings pages; see lib/docs/settingsWalks.ts. */
export const WALKS: Record<string, SettingsWalk> = {
  "sales-process": {
    outcome: "Your agents' call is set step by step: the health questions, the quote inputs, each carrier's application, the checks, the disclosures and where a card moves after submit.",
    minutes: 25,
    steps: [
      { say: "Start on the Overview tab", detail: "It maps the call in the order your agent meets it, with what each step is set to now.", find: spTab("Overview"), then: "open" },
      { say: "Read the Needs you list", detail: "Anything missing or out of date is listed here, with a button that takes you to the right tab.", find: "section[aria-label=\"Needs you\"]" },
      { say: "Open the Health questions tab", detail: "These are the questions asked on the Interview. A Yes or No can knock a carrier out, so the agent only quotes what the client can get.", find: spTab("Health questions"), then: "open" },
      { say: "Pick a question set", detail: "There is one set per product, and a carrier can have its own. Your changes stay a draft until you publish them.", find: "section[aria-label=\"Question sets\"]" },
      { say: "Open the Quote inputs tab", detail: "This is what the agent types on the Quote step for each carrier and product, such as face amount and riders.", find: spTab("Quote inputs"), then: "open" },
      { say: "Check your default for every carrier", detail: "A carrier uses your default unless you give it its own inputs. Click a row to see or change it.", find: "#quote-inputs table tbody tr" },
      { say: "Open the Carrier application tab", detail: "Each carrier's application form: which fields are asked, in what order, and which are required.", find: spTab("Carrier application"), then: "open" },
      { say: "Pick a carrier", detail: "Carriers share one set until you give one its own. Missing required fields stop a case at QA.", find: "section[aria-label=\"Carriers\"]:not(:has-text(\"Loading carriers\"))" },
      { say: "Open the Quote & case checks tab", detail: "These checks catch a quote or case that looks wrong before it reaches the carrier.", find: spTab("Quote & case checks"), then: "open" },
      { say: "Set the quote band per $1,000", detail: "A premium outside the lowest and highest per $1,000 is flagged, so a typo doesn't go out as a quote.", find: "#qa-band-min" },
      { say: "Give term products their own band", detail: "A product given its own band is checked against it instead. It's the only way a term quote is checked, and the product must be switched on first.", find: "#qa-product-bands:not(:has-text(\"Loading your products\"))" },
      { say: "Choose Block or Warn when not appointed", detail: "Block stops the case at Quote until the carrier's appointment in the client's state is active. Warn lets it go on with a warning.", find: "#qa-appointment" },
      { say: "Set the Draft-date buffer", detail: "The first draft lands at least this many days after the client's deposit, so the money is there when the carrier pulls it.", find: "#qa-buffer" },
      { say: "Set Flag open requirements after", detail: "A carrier requirement older than this turns amber on Pending, and red at twice that, so nothing sits unworked.", find: "#qa-ageing" },
      { say: "Choose Send or Hold for the Welcome pack", detail: "Send mails it to the client once the case is submitted. Hold waits in the agent's queue until someone sends it. Save on the title line stores this tab.", find: "#qa-welcome" },
      { say: "Open the Disclosures tab", detail: "The documents and scripts your agent reads or sends on the call, by state and carrier.", find: spTab("Disclosures"), then: "open" },
      { say: "Check each document is live", detail: "Each row shows its version and where it applies. A draft is not read on calls until you publish it.", find: "guide:disclosures-table" },
      { say: "Open the Stage moves tab", detail: "When an application changes, its lead card moves to the stage you pick here, so the board stays right without anyone dragging cards.", find: spTab("Stage moves"), then: "open" },
      { say: "Pick a pipeline and where each card goes", detail: "Each pipeline has its own map from application status to stage. Your changes wait until you save them.", find: "select[aria-label=\"Pipeline\"]" },
    ],
  },
  "application-forms": {
    outcome: "You know which forms partners and agents fill in, what each one asks and who can apply.",
    minutes: 10,
    steps: [
      { say: "Look over your forms", detail: "Each product has its own form. The list shows its version, use in the last 30 days and whether it is Live, Draft or Off.", find: "table" },
      { say: "Find a form", detail: "Type a name or product to narrow the list.", find: "label:Find a form" },
      { say: "Open a form", detail: "Clicking a row opens the form's builder. Nothing changes until you publish.", find: "table tbody tr", then: "open" },
      { say: "Read the status line", detail: "It says which version is live and how many changes aren't published yet. Your draft is kept as you work.", find: "[role=\"status\"]:has-text(\"version\")" },
      { say: "Look at the form's pages", detail: "Each page is a tab, with its questions in order. Drag a question to move it.", find: "[role=\"radiogroup\"][aria-label=\"Pages\"]" },
      { say: "Click Preview", detail: "It shows the draft the way a partner sees it. Nothing is saved from the preview.", find: "text:Preview" },
      { say: "Open the Settings tab", detail: "Set who can apply by age, name the form's parts and pick which pipeline new leads land in.", find: "[role=\"tab\"]:has-text(\"Settings\")", then: "open" },
      { say: "Set the youngest and oldest age", detail: "Someone outside these ages can't send the form, so you don't get leads you can't write.", find: "#form-who-can-apply" },
    ],
  },
  "ai-assistant": {
    outcome: "You know what the AI assistant will do, what data it would be sent, and whether you're on the early list.",
    minutes: 3,
    steps: [
      { say: "Read the status line", detail: "The assistant isn't available yet. This line says so and whether you're on the early list.", find: "[role=\"status\"]" },
      { say: "Look over What it does", detail: "Each planned feature has an example. Nothing it writes is saved or sent to a client without an agent's click.", find: "[role=\"tab\"]:has-text(\"What it does\")" },
      { say: "Open the Your data tab", detail: "It lists exactly what would be sent, only for the feature in use, and what is never sent, such as names and Social Security numbers.", find: "[role=\"tab\"]:has-text(\"Your data\")", then: "open" },
      { say: "Check Data controls", detail: "Your own choices about what the assistant may use. They apply the day it's ready.", find: "text:Data controls" },
      { say: "Join the early list if you want it", detail: "You'll hear when it's ready. Joining doesn't turn anything on.", find: "text:early list" },
    ],
  },
  "settings-history": {
    outcome: "You can find who changed a setting, from what to what, and when.",
    minutes: 2,
    steps: [
      { say: "Find a setting", detail: "Type the name of a setting to see only its changes.", find: "[placeholder^=\"Find a setting\"]" },
      { say: "Narrow by Section or Person", detail: "Filter to one part of Settings or one person, to see why something behaves differently.", find: "[aria-label^=\"Section:\"]" },
      { say: "Read the list of changes", detail: "One line a change, grouped by day. It's read only and kept for good.", find: "table" },
      { say: "Click a row to see the change", detail: "It shows the old value and the new one side by side.", find: "[aria-label^=\"Open: \"]" },
      { say: "Click Export CSV to keep a copy", detail: "It downloads the changes you're looking at, for an audit or a review.", find: "text:Export CSV" },
    ],
  },
};
