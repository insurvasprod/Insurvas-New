import { setupStepDefinitions, setupStepGroup } from "../dashboard/checklist.ts";
import { guideMovesFor } from "../dashboard/guideMoves.ts";

/**
 * Docs (owner, 2026-11-13): "something like Vercel docs… not documentation… trying to help people get set
 * up into insurance… leave places for the video". Simple pages, one at a time (owner: "don't make it like a
 * book you have to scroll around"): chapters on the left, the page in the middle, "On this page" on the
 * right. Every page has one video slot, keyed so a video can be attached later without touching the page.
 *
 * Chapter 3 is built from Get set up itself (checklist.ts + guideMoves.ts), so its pages can never drift
 * from the steps and the guide. The insurance chapters are plain guidance, not legal advice.
 */

export type DocSection = { id: string; heading: string; paragraphs?: string[]; list?: string[] };

export type DocPage = {
  slug: string;
  chapter: string;
  title: string;
  minutes: number;
  summary: string;
  /** The video slot: `url` empty means "Video coming". */
  video: { key: string; title: string; url?: string };
  sections: DocSection[];
  terms?: [string, string][];
  /** A Get set up step this page explains: the page offers "Do it in Insurvas" (its guide) or says it's done. */
  stepKey?: string;
  /** A page in Insurvas to open, for pages with no setup step. */
  open?: { href: string; label: string };
  /**
   * A "how to" page, exactly step by step (R4, owner 2026-11-13): the ordered steps with their time, cost and the
   * moment in the video. The reader ticks them off; the first not ticked is the one they are on.
   */
  steps?: DocStep[];
  /** A few figures over the page: total time, typical cost. */
  facts?: { label: string; value: string }[];
  /** One line to read before the steps. */
  before?: string;
};

export type DocStep = {
  title: string;
  detail: string;
  time?: string;
  cost?: string;
  /** The moment in the page's video. */
  at?: string;
  /**
   * A step Insurvas can see done (R4 rework, owner 2026-11-13: "if he has completed it, there is no need to show
   * that button anymore"): the setup step whose fact ticks it, or "ready" for the whole of Ready to sell.
   */
  doneWhen?: string;
  /** The step's one button while it is not done: a page, or a setup step's guide (`step`). */
  action?: { label: string; href?: string; step?: string };
};

export type DocChapter = { key: string; title: string; summary: string };

export const DOC_CHAPTERS: readonly DocChapter[] = [
  { key: "start", title: "Getting into insurance", summary: "Licence, exam, non-resident states, E&O, AML and CE." },
  { key: "contracted", title: "Getting contracted", summary: "IMOs, appointments, contract levels and writing numbers." },
  { key: "setup", title: "Set up Insurvas to sell", summary: "Every Get set up step: what it does and each click." },
  { key: "rules", title: "Selling within the rules", summary: "Do-not-call, TCPA, calling hours, disclosures and recording." },
  { key: "after", title: "After the sale", summary: "Underwriting, issue, commissions, chargebacks and retention." },
  { key: "agency", title: "Running an agency", summary: "Hierarchy, overrides, onboarding producers and team setup." },
];

const page = (chapter: string, slug: string, title: string, minutes: number, summary: string, sections: DocSection[], extra: Partial<DocPage> = {}): DocPage => ({
  slug, chapter, title, minutes, summary, video: { key: `${chapter}.${slug}`, title }, sections, ...extra,
});

const WRITTEN: DocPage[] = [
  page("start", "your-path", "Your path to selling insurance", 4, "The order most new agents go in, from no licence to a first sale.", [
    { id: "time", heading: "How long it takes", paragraphs: ["Most people go from starting a course to a first sale in four to eight weeks. The exam and the carrier appointments are usually the slowest parts."] },
  ], {
    before: "Pick your lines first: life, health, or both. Every step below is per line, and most agents take both.",
    facts: [{ label: "Total time", value: "4–8 weeks" }, { label: "Typical cost", value: "$300–$700" }, { label: "Steps", value: "6" }],
    steps: [
      { title: "Take a pre-licensing course", detail: "An approved course for each line you want to sell.", time: "20–40 hours", cost: "$100–$250", at: "0:00" },
      { title: "Pass the state exam", detail: "At a test centre or online, proctored. You get the result the same day.", time: "2 hours", cost: "$40–$150", at: "0:34" },
      { title: "Apply for your resident licence", detail: "Through NIPR, with fingerprints and a background check.", time: "1–3 weeks", cost: "$50–$200", at: "1:12" },
      { title: "Get E&O insurance and AML training", detail: "Most carriers ask for both before they contract you.", time: "1 day", cost: "$25–$60 a month", at: "1:50" },
      { title: "Contract with carriers", detail: "Usually through an IMO or FMO; then each carrier appoints you in your states.", time: "1–3 weeks", cost: "Free", at: "2:20" },
      { title: "Set up Insurvas and start calling", detail: "Get set up walks you through every click.", time: "About 1 hour", at: "2:45", doneWhen: "ready", action: { label: "Open Get set up", href: "/app/setup" } },
    ],
  }),
  page("start", "licence", "Pre-licensing, the exam and your licence", 5, "What you study, how the exam works, and how to apply.", [
    { id: "course", heading: "Pre-licensing course", paragraphs: ["Most states require a set number of course hours for each line of authority before you can sit the exam. Life and health are separate lines; many agents take both."] },
    { id: "exam", heading: "The state exam", paragraphs: ["The exam is taken at a testing centre or online, proctored. You get your result the same day. A fail can be retaken after a short wait."] },
    { id: "apply", heading: "Applying for your licence", paragraphs: ["After passing, you apply to your home state, usually through NIPR, with fingerprints and a background check. Your resident licence number is what carriers ask for first."] },
  ], { terms: [["Line of authority", "What a licence lets you sell, such as life or accident and health"], ["NIPR", "The national producer registry most states use for applications and renewals"], ["NPN", "Your national producer number, the same in every state"]] }),
  page("start", "non-resident", "Non-resident licences", 3, "Selling to people in other states.", [
    { id: "what", heading: "What it is", paragraphs: ["To sell to someone who lives in another state, you need a non-resident licence there. With an active resident licence, most states grant one through NIPR without another exam."] },
    { id: "which", heading: "Which states", paragraphs: ["Start with the states your leads come from. Each licence has its own fee and renewal date, so add states as you need them."] },
  ]),
  page("start", "eo-aml-ce", "E&O, AML and continuing education", 4, "The three things carriers check before they contract you.", [
    { id: "eo", heading: "E&O insurance", paragraphs: ["Errors and omissions insurance covers you if a client says you gave bad advice. Most carriers ask for a certificate, often for $1 million per claim."] },
    { id: "aml", heading: "AML training", paragraphs: ["Anti-money-laundering training is a short online course. Carriers ask for the certificate, and some have their own product training on top."] },
    { id: "ce", heading: "Continuing education", paragraphs: ["Each licence renewal needs CE hours. Keep your certificates: a carrier or state may ask for them."] },
  ]),
  page("contracted", "imo-or-direct", "Direct, IMO or FMO?", 4, "Who you contract through, and why most new agents use an IMO.", [
    { id: "imo", heading: "Through an IMO or FMO", paragraphs: ["An IMO or FMO sends one set of paperwork to many carriers, often gets you a higher contract level, and helps with underwriting questions and leads."] },
    { id: "direct", heading: "Direct", paragraphs: ["Going direct means a separate contract with each carrier. It makes sense once you write enough business for a carrier to offer it."] },
  ]),
  page("contracted", "appointments", "Getting appointed with carriers", 5, "What an appointment is and what the carrier asks for.", [
    { id: "what", heading: "What an appointment is", paragraphs: ["Your licence lets you sell insurance. An appointment is a carrier saying you may sell its products, filed with each state you sell in."] },
    { id: "time", heading: "How long it takes", paragraphs: ["Usually one to three weeks per carrier. Some states need you appointed before you take an application; others accept it when the first application arrives."] },
  ], { stepKey: "carriers", terms: [["Appointment", "A carrier's filing that lets you sell its products in a state"], ["Writing number", "Your ID with a carrier, printed on its commission statements"]],
    facts: [{ label: "Per carrier", value: "1–3 weeks" }, { label: "Cost", value: "Usually free" }],
    steps: [
      { title: "Choose who you contract through", detail: "An IMO or FMO, or the carrier directly.", time: "1 day" },
      { title: "Send the contracting packet", detail: "Your licence numbers, E&O and AML certificates, a background check and bank details for commissions.", time: "1 hour" },
      { title: "Wait for the appointment", detail: "The carrier files it with each state you sell in.", time: "1–3 weeks" },
      { title: "Add the carrier and its writing number in Insurvas", detail: "So quotes offer it and its statements match your policies.", time: "5 minutes", doneWhen: "carriers", action: { label: "Do it in Insurvas", step: "carriers" } },
    ] }),
  page("contracted", "contract-levels", "Contract levels and advances", 4, "How much a carrier pays you, and when.", [
    { id: "level", heading: "Your contract level", paragraphs: ["The level is the share of a policy's first-year target premium the carrier pays you, such as 105%. New agents often start between 80% and 100%; production and persistency raise it."] },
    { id: "advance", heading: "Advances", paragraphs: ["Many carriers advance most of the first-year commission, often 75%, when the policy issues, and pay the rest over the year."] },
  ]),
  page("contracted", "writing-numbers", "Writing numbers", 2, "Why Insurvas asks for them.", [
    { id: "what", heading: "What they are for", paragraphs: ["Each carrier gives you a writing number. It is printed on every statement, so Insurvas uses it to match the money to you and your producers. It's optional in Add your carriers, and worth adding."] },
  ], { stepKey: "carriers" }),
  page("rules", "dnc-tcpa", "Do-not-call and the TCPA", 5, "Who you may call, and how Insurvas checks it.", [
    { id: "dnc", heading: "Do-not-call lists", paragraphs: ["The national and state do-not-call lists name people who don't want sales calls. Calling them without consent can be fined per call."] },
    { id: "tcpa", heading: "The TCPA", paragraphs: ["The Telephone Consumer Protection Act sets rules on consent, autodialers and texts. Insurvas checks every imported lead against do-not-call lists and known litigators before anyone dials it."] },
  ], { stepKey: "import" }),
  page("rules", "calling-hours", "Calling hours", 2, "When you may call a lead.", [
    { id: "hours", heading: "The hours", paragraphs: ["Federal rules allow sales calls between 8 am and 9 pm in the lead's own time zone, and some states are stricter. Insurvas never offers a lead outside your hours or the law's."] },
  ], { stepKey: "calling-windows" }),
  page("rules", "disclosures-recording", "Disclosures and call recording", 3, "What you read to a client, and recording consent.", [
    { id: "disclosures", heading: "Disclosures", paragraphs: ["Some carriers and states require you to read set wording before an application. Insurvas shows the disclosure on the call and records that it was read."] },
    { id: "recording", heading: "Recording consent", paragraphs: ["Some states need everyone on the call to agree to recording. Say the call is recorded at the start."] },
  ], { stepKey: "disclosures" }),
  page("after", "underwriting-to-issue", "From application to in force", 4, "What happens after you submit.", [], {
    open: { href: "/app/applications", label: "Open Applications" },
    facts: [{ label: "Typical time", value: "1–6 weeks" }, { label: "Stages", value: "4" }],
    steps: [
      { title: "Submitted", detail: "The carrier has the application." },
      { title: "Underwriting", detail: "The carrier checks health, records and the payment method.", time: "Days to weeks" },
      { title: "Issued", detail: "The policy is approved; most carriers advance commission now." },
      { title: "In force", detail: "The first premium is paid and cover starts." },
    ] }),
  page("after", "commissions", "Commissions and statements", 4, "How you get paid, and how Insurvas checks it.", [
    { id: "statements", heading: "Carrier statements", paragraphs: ["Each carrier sends a statement, usually monthly, listing what it paid you and what it took back. Upload it and Insurvas matches every line to your policies and shows anything missing or short-paid."] },
  ], { stepKey: "statement" }),
  page("after", "chargebacks", "Chargebacks and persistency", 3, "When a carrier takes commission back.", [
    { id: "chargeback", heading: "Chargebacks", paragraphs: ["If a policy lapses in its first year, the carrier takes back the part of the advance not yet earned. Insurvas flags policies at risk before that happens."] },
    { id: "persistency", heading: "Persistency", paragraphs: ["Persistency is the share of your policies still in force after a year. Carriers use it to set your contract level."] },
  ], { open: { href: "/app/retention", label: "Open Retention" } }),
  page("agency", "hierarchy-overrides", "Hierarchy and overrides", 3, "Who reports to whom, and what the agency keeps.", [
    { id: "hierarchy", heading: "Your hierarchy", paragraphs: ["Each producer sits under an upline. Overrides, the difference between levels, are paid up that line."] },
  ], { stepKey: "hierarchy" }),
  page("agency", "onboarding-producers", "Onboarding producers", 3, "Getting a new producer licensed, contracted and dialing.", [], {
    stepKey: "team",
    facts: [{ label: "Typical time", value: "1–2 weeks" }, { label: "Steps", value: "4" }],
    steps: [
      { title: "Invite them", detail: "From Settings › Team & access, with their role.", time: "2 minutes", doneWhen: "team", action: { label: "Do it in Insurvas", step: "team" } },
      { title: "They add their licence, appointments and W-9", detail: "On their own producer record.", time: "15 minutes" },
      { title: "You approve their contracting", detail: "On their record's Onboarding tab.", time: "5 minutes" },
      { title: "They follow their own Get started", detail: "Guided like yours, on the pages they use." },
    ] }),
  page("agency", "team-setup", "Your team's setup", 2, "See whether everyone has finished setting up Insurvas.", [
    { id: "where", heading: "Where to see it", paragraphs: ["The agency dashboard has a Team setup button. It lists each person, how far through their setup they are, and their next step."] },
  ], { open: { href: "/app/agency/team-setup", label: "Open Team setup" } }),
];

/** The step-by-step version of each written page (R4 rework, owner 2026-11-13: "what is all of that text?"). */
const STEPS_FOR: Record<string, Pick<DocPage, "steps" | "facts" | "before">> = {
  licence: {
    facts: [{ label: "Total time", value: "3–6 weeks" }, { label: "Typical cost", value: "$200–$600" }, { label: "Steps", value: "4" }],
    before: "Life and health are separate lines of authority. Most agents take both, one course and exam each.",
    steps: [
      { title: "Choose your lines of authority", detail: "Life, accident and health, or both.", time: "1 day" },
      { title: "Finish an approved pre-licensing course", detail: "Your state sets the hours for each line.", time: "20–40 hours", cost: "$100–$250" },
      { title: "Book and pass the state exam", detail: "At a test centre or online, proctored. The result comes the same day; a fail can be retaken after a short wait.", time: "2 hours", cost: "$40–$150" },
      { title: "Apply for your resident licence", detail: "Usually through NIPR, with fingerprints and a background check. Your licence number is what carriers ask for first.", time: "1–3 weeks", cost: "$50–$200" },
    ],
  },
  "non-resident": {
    facts: [{ label: "Per state", value: "1–2 weeks" }, { label: "Typical cost", value: "$50–$300" }],
    before: "You need an active resident licence first. Most states grant a non-resident licence without another exam.",
    steps: [
      { title: "List the states your leads come from", detail: "Add states as you need them; each has its own fee and renewal date.", time: "1 hour" },
      { title: "Apply for each state through NIPR", detail: "Your resident licence carries over; no new exam in most states.", time: "30 minutes a state", cost: "$50–$300 a state" },
      { title: "Get appointed in those states", detail: "Each carrier files its appointment in every state you sell in.", time: "1–3 weeks" },
      { title: "Add the states in Insurvas", detail: "Quotes and leads follow the states you're appointed in.", doneWhen: "states", action: { label: "Do it in Insurvas", step: "states" } },
    ],
  },
  "eo-aml-ce": {
    facts: [{ label: "Total time", value: "1–2 days" }, { label: "Typical cost", value: "$25–$60 a month" }],
    steps: [
      { title: "Buy E&O insurance", detail: "Covers you if a client says you gave bad advice. Carriers often ask for $1 million per claim.", time: "1 hour", cost: "$25–$60 a month" },
      { title: "Take AML training", detail: "A short online anti-money-laundering course; keep the certificate.", time: "2–4 hours", cost: "Often free" },
      { title: "Take each carrier's product training", detail: "Some carriers ask for their own short course before you sell.", time: "1 hour each" },
      { title: "Keep up continuing education", detail: "Each licence renewal needs CE hours. Keep every certificate.", time: "Every 2 years" },
    ],
  },
  "imo-or-direct": {
    facts: [{ label: "Decision", value: "1 day" }, { label: "Cost", value: "Usually free" }],
    steps: [
      { title: "Decide how much support you want", detail: "New agents usually want leads, training and underwriting help.", time: "1 hour" },
      { title: "Compare two or three IMOs or FMOs", detail: "Ask about contract levels, carriers offered and who owns your book.", time: "Half a day" },
      { title: "Sign with one", detail: "It sends one contracting packet to many carriers for you.", time: "1 hour" },
      { title: "Go direct later, when you write enough", detail: "A carrier offers a direct contract once your production justifies it." },
    ],
  },
  "contract-levels": {
    facts: [{ label: "New agents", value: "80–100%" }, { label: "Advance", value: "Often 75%" }],
    steps: [
      { title: "Read your contract level", detail: "The share of a policy's first-year target premium the carrier pays you, such as 105%." },
      { title: "Know the advance", detail: "Many carriers pay most of the first-year commission when the policy issues, often 75%." },
      { title: "Know what is paid later", detail: "The rest of the first year is paid as the client keeps paying." },
      { title: "Grow your level", detail: "Production and persistency raise it; your IMO asks the carrier for you." },
    ],
  },
  "writing-numbers": {
    facts: [{ label: "Time", value: "5 minutes" }],
    steps: [
      { title: "Find each carrier's writing number", detail: "It comes with your appointment, and is printed on every statement." },
      { title: "Add it in Insurvas", detail: "On the carrier's row in Add your carriers. It's optional, and worth it.", doneWhen: "carriers", action: { label: "Do it in Insurvas", step: "carriers" } },
      { title: "Let statements match themselves", detail: "Insurvas uses it to match the money to you and your producers." },
    ],
  },
  "dnc-tcpa": {
    facts: [{ label: "Fines", value: "Per call" }, { label: "Checked", value: "Every import" }],
    steps: [
      { title: "Only call people with consent or no do-not-call listing", detail: "The national and state lists name people who don't want sales calls." },
      { title: "Follow the TCPA on consent, autodialers and texts", detail: "Consent must be clear and kept." },
      { title: "Import leads through Insurvas", detail: "Every lead is checked against do-not-call lists and known litigators before anyone dials it.", doneWhen: "import", action: { label: "Do it in Insurvas", step: "import" } },
      { title: "Honour opt-outs at once", detail: "Mark Do not call on the lead; it never comes back to the dialer." },
    ],
  },
  "calling-hours": {
    facts: [{ label: "Federal window", value: "8 am–9 pm" }, { label: "In", value: "The lead's time zone" }],
    steps: [
      { title: "Know the federal window", detail: "Sales calls between 8 am and 9 pm in the lead's own time zone." },
      { title: "Check your states' stricter rules", detail: "Some states shorten the hours or block Sundays and holidays." },
      { title: "Set your agency's hours in Insurvas", detail: "The dialer never offers a lead outside your hours or the law's.", doneWhen: "calling-windows", action: { label: "Do it in Insurvas", step: "calling-windows" } },
    ],
  },
  "disclosures-recording": {
    facts: [{ label: "When", value: "Before the application" }],
    steps: [
      { title: "Say the call is recorded, at the start", detail: "Some states need everyone on the call to agree to recording." },
      { title: "Read each required disclosure", detail: "Some carriers and states set wording you must read before an application." },
      { title: "Let Insurvas record that it was read", detail: "The disclosure shows on the call, and the reading is kept with the application.", doneWhen: "disclosures", action: { label: "Do it in Insurvas", step: "disclosures" } },
    ],
  },
  commissions: {
    facts: [{ label: "Statements", value: "Usually monthly" }],
    steps: [
      { title: "Get each carrier's statement", detail: "It lists what the carrier paid you and what it took back." },
      { title: "Upload it to Insurvas", detail: "PDF, Excel or CSV, as the carrier sent it.", doneWhen: "statement", action: { label: "Do it in Insurvas", step: "statement" } },
      { title: "Accept the matches", detail: "Insurvas matches every line to a policy; accepted lines go to your ledger." },
      { title: "Claim what's missing", detail: "Anything missing, short-paid or wrongly charged back shows up in Discrepancies." },
    ],
  },
  chargebacks: {
    facts: [{ label: "Risk window", value: "First year" }],
    steps: [
      { title: "Watch policies in their first year", detail: "If one lapses, the carrier takes back the part of the advance not yet earned." },
      { title: "Work the save queue", detail: "Insurvas flags policies at risk before the lapse." },
      { title: "Keep persistency up", detail: "The share of policies still in force after a year sets your contract level." },
    ],
  },
  "hierarchy-overrides": {
    facts: [{ label: "Set up", value: "10 minutes" }],
    steps: [
      { title: "Place each producer under their upline", detail: "In Reports › Hierarchy, More › Change a manager.", doneWhen: "hierarchy", action: { label: "Do it in Insurvas", step: "hierarchy" } },
      { title: "Know the override", detail: "The difference between an upline's level and the producer's, paid up the line." },
      { title: "Check it on statements", detail: "Insurvas works overrides out from what the carriers paid." },
    ],
  },
  "team-setup": {
    facts: [{ label: "Where", value: "Agency dashboard" }],
    steps: [
      { title: "Open the agency dashboard", detail: "Home › Agency." },
      { title: "Click Team setup", detail: "It lists each person, how far through setup they are, and their next step.", action: { label: "Open Team setup", href: "/app/agency/team-setup" } },
      { title: "Nudge anyone who hasn't started", detail: "Each person follows their own Get started, guided like yours." },
    ],
  },
};

/** Chapter 3: one page per Get set up step, from the step's own words and its guide's moves. */
function setupPages(): DocPage[] {
  return setupStepDefinitions().map((step) => ({
    slug: step.key,
    chapter: "setup",
    title: step.label,
    minutes: 2,
    summary: step.why,
    video: { key: `setup.${step.key}`, title: step.label },
    stepKey: step.key,
    sections: [
      { id: "why", heading: "Why it matters", paragraphs: [step.why] },
      { id: "clicks", heading: "Each click", list: guideMovesFor(step).map((move) => (move.detail ? `${move.say}. ${move.detail}` : `${move.say}.`)) },
    ],
  }));
}

export function allDocPages(): DocPage[] {
  const pages = [...WRITTEN.map((item) => (STEPS_FOR[item.slug] ? { ...item, ...STEPS_FOR[item.slug] } : item)), ...setupPages()];
  const order = new Map(DOC_CHAPTERS.map((chapter, index) => [chapter.key, index]));
  return pages
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (order.get(a.item.chapter) ?? 99) - (order.get(b.item.chapter) ?? 99) || a.index - b.index)
    .map(({ item }) => item);
}

/** What Docs search reads: each page (with its steps and terms), each key term on its own, and the reader's Insurvas pages. */
export function docsSearchIndex(insurvas: { title: string; href: string; meta: string }[] = []): { kind: "doc" | "insurvas" | "term"; href: string; title: string; meta: string; text: string }[] {
  const chapters = new Map(DOC_CHAPTERS.map((chapter) => [chapter.key, chapter.title]));
  const pages = allDocPages();
  return [
    ...pages.map((item) => ({
      kind: "doc" as const,
      href: `/app/docs/${item.slug}`,
      title: item.title,
      meta: `${chapters.get(item.chapter) ?? ""} · ${item.minutes} min`,
      text: [item.summary, item.before ?? "", ...item.sections.flatMap((section) => [section.heading, ...(section.paragraphs ?? []), ...(section.list ?? [])]), ...(item.steps ?? []).flatMap((step) => [step.title, step.detail])].join(" "),
    })),
    ...pages.flatMap((item) => (item.terms ?? []).map(([term, meaning]) => ({ kind: "term" as const, href: `/app/docs/${item.slug}#terms`, title: term, meta: meaning, text: meaning }))),
    ...insurvas.map((entry) => ({ kind: "insurvas" as const, href: entry.href, title: entry.title, meta: entry.meta, text: entry.title })),
  ];
}

/** The pages as Docs' menu and home read them: the setup chapter's steps carry whether they are optional. */
export function docsMenuPages(): { slug: string; title: string; chapter: string; stepKey?: string; minutes: number; optional?: boolean }[] {
  return allDocPages().map((item) => ({
    slug: item.slug, title: item.title, chapter: item.chapter, minutes: item.minutes,
    ...(item.stepKey ? { stepKey: item.stepKey } : {}),
    ...(item.chapter === "setup" && item.stepKey && setupStepGroup(item.stepKey) === "later" ? { optional: true } : {}),
  }));
}

export function docPage(slug: string): DocPage | null {
  return allDocPages().find((item) => item.slug === slug) ?? null;
}
