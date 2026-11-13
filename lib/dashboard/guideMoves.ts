/**
 * Guided setup, round 3 (owner, 2026-11-12/13): each Get set up step opens its real page and the guide
 * shows every click on it — "click this first, then this, then do this". This file is the script: an
 * ordered list of moves per step. The guide (components/app/setup/setup-guide-bar.tsx) lights one move's
 * control at a time and moves on when the person does the action, never on a Next button, except where a
 * move only asks them to check something ("Looks right").
 *
 * A move's `target` is the `data-guide` attribute on the control. A target that is not on the screen yet
 * (a dialog not open, a set-up on its other step) is waited for; if a later move's target is already
 * there, the guide jumps to it, so arriving mid-way works. A move with no target is said in the setup bar.
 *
 * The step's own fact (setupProgress.ts) still decides Done. Moves only say how to get there.
 *
 * Required vs optional (owner, 2026-11-13): Ready to sell — the counted steps — always run guided and have
 * no Skip, only Pause. The optional steps (Fine-tune later) offer Skip and Stop guide.
 */

/** What moves the guide on from a move. */
export type GuideAdvance =
  /** A click on the target. */
  | "click"
  /** The target losing focus: a field was filled (or left). */
  | "leave"
  /** Only a look: the coach shows "Looks right". */
  | "check"
  /** The control named by `until` appearing (a menu item opened a dialog the guide cannot see into). */
  | "appear"
  /** The last move: waits for the step's own fact to turn true (it saves itself). */
  | "done";

export type GuideMove = {
  /** A `data-guide` value, or `#id` for an element id the page already has (a settings row). */
  target?: string;
  /** For "appear": the control whose arrival moves the guide on. */
  until?: string;
  /** What to do, naming the control by the label the page shows. */
  say: string;
  /** One line on why or what happens next. */
  detail?: string;
  advance: GuideAdvance;
  /** A field the form itself marks optional: the coach offers "Skip this". */
  optional?: boolean;
  /** The picture of the screen on the step's Docs page. */
  shot?: GuideShot;
};

const MOVES: Record<string, readonly GuideMove[]> = {
  carriers: [
    { target: "carriers-setup-list", say: "Tick each carrier you're contracted with", detail: "Every tick saves. Level, contracted from and writing number are optional: add them now or later.", advance: "click" },
    { target: "carriers-setup-next", say: "Click Next: Set Up States", detail: "Your carriers are already saved. Next you pick the states you sell in.", advance: "click" },
  ],
  states: [
    { target: "carriers-setup-next", say: "Click Next: Set Up States", detail: "Your carriers are saved. This opens the states.", advance: "click" },
    { target: "states-setup-list", say: "Click a state you sell in", detail: "Then tick the carriers you're appointed with there. Every tick saves.", advance: "click" },
    { target: "states-setup-list", say: "Tick your carriers in each state", detail: "Do every state you sell in. Quotes only offer what is ticked here.", advance: "check" },
    { target: "states-setup-finish", say: "Click Finish set-up", advance: "click" },
  ],
  "lead-sources": [
    { target: "publisher-add", say: "Click Add publisher", detail: "A publisher is a company that sends you leads or transfers calls.", advance: "click" },
    { target: "publisher-submit", say: "Fill in the company, then click Add publisher", detail: "Only the company name is needed now. Contact, country and pay can wait.", advance: "click" },
  ],
  campaign: [
    { target: "campaign-vendor-new", say: "Click New Vendor", detail: "The company you buy leads from. Skip this if it's already listed.", advance: "click" },
    { target: "campaign-new", say: "Click New Campaign", detail: "A campaign is one batch of leads you bought, so its cost is tracked.", advance: "click" },
    { target: "campaign-create", say: "Pick the vendor, name it, then click Create campaign", advance: "click" },
  ],
  import: [
    { target: "lead-import-upload", say: "Click Choose a file", detail: "A CSV or Excel file of your leads.", advance: "click" },
    { target: "lead-import-continue", say: "Check the columns, then click Continue to Review", detail: "Insurvas checks do-not-call, litigators and duplicates. Nothing is written yet.", advance: "click" },
    { say: "Review the leads, then import them", detail: "Get set up ticks this step once the import lands.", advance: "done" },
  ],
  team: [
    { target: "team-invite", say: "Click Invite someone", advance: "click" },
    { say: "Add their name, email and role, then send the invite", detail: "The role decides what they see. The sheet shows any seat cost before it sends.", advance: "done" },
  ],
  "calling-windows": [
    { say: "Check your earliest and latest calling hours", detail: "They apply in each lead's own time zone. Federal and state limits always apply on top.", advance: "check" },
    { target: "calling-windows-save", say: "Click Save changes", advance: "click" },
  ],
  assign: [
    { target: "assignments-assign", say: "Hand out leads to your agents", detail: "Each agent's dialer only holds the leads given to them.", advance: "click" },
  ],
  statement: [
    { target: "statement-open", say: "Click Import a statement", advance: "click" },
    { target: "statement-file", say: "Choose the statement file, then pick its carrier and period", detail: "PDF, Excel or CSV, as the carrier sent it.", advance: "click" },
    { target: "statement-next", say: "Click Next: columns", advance: "click" },
    { target: "statement-preview", say: "Match Policy number and Amount, then click Preview", detail: "Insurvas remembers the columns for this carrier next time.", advance: "click" },
    { target: "statement-import", say: "Check the matches, then click Import for review", detail: "Nothing reaches your ledger until you accept the matches.", advance: "click" },
  ],
  book: [
    { target: "book-carriers", say: "Click Bring it in on a carrier", detail: "Each carrier row says where to find its policy report.", advance: "click" },
    { target: "book-upload", say: "Drop its policy report in, then click Upload", detail: "Skip for now on any carrier you don't have a file for.", advance: "click" },
    { say: "Do the same for each carrier you have a file for", advance: "done" },
  ],
  outcomes: [
    { target: "pipeline-setup", say: "Click Set up on your sales pipeline", detail: "Each pipeline has its own outcomes.", advance: "click" },
    { target: "pipeline-outcomes", say: "Check where each call outcome moves a lead", detail: "Each one already goes to the stage with its own name. Change only what you want elsewhere.", advance: "check" },
  ],
  disclosures: [
    { target: "disclosures-table", say: "Read the disclosures Insurvas already uses", detail: "Add your own with Add a document only if a carrier or state asks for more.", advance: "check" },
  ],
  phone: [
    { target: "#agency-support-phone", say: "Type the phone number partners should call", detail: "It shows in the partner portal and on partner messages.", advance: "leave" },
    { say: "Click Save changes", advance: "done" },
  ],
  "queue-sla": [
    { say: "Check when an unclaimed transfer warns, escalates and expires", advance: "check" },
    { target: "queue-sla-save", say: "Click Save changes", advance: "click" },
  ],
  retention: [
    { target: "#thresholds", say: "Click The save queue takes", detail: "It decides which at-risk policies reach the save queue.", advance: "click" },
    { say: "Pick a band, then click Save", detail: "Medium and above is where most agencies start.", advance: "done" },
  ],
  compliance: [
    { target: "#retention", say: "Check how long each kind of record is kept", detail: "Open a record to add a rule, only where a state asks for longer.", advance: "check" },
  ],
  accounting: [
    { target: "#vendor-bills", say: "Click Flag a bill that differs from your count by more than", advance: "click" },
    { say: "Set the amount, then click Save", advance: "done" },
  ],
  hierarchy: [
    { say: "Open More on the title line, then click Change a manager", detail: "Overrides and producer pay follow this hierarchy.", advance: "appear", until: "hierarchy-save" },
    { target: "hierarchy-save", say: "Pick the producer and who they report to, then click Save", detail: "Do it once for each producer.", advance: "done" },
  ],
  "first-call": [
    { target: "dialer-next", say: "Click Serve next lead", detail: "Your queue holds the leads assigned to you, inside calling hours.", advance: "click" },
    { say: "Call them, then record what happened", advance: "done" },
  ],
  "first-transfer": [
    { target: "inbound-claim", say: "Click Take this call", detail: "An unclaimed transfer escalates after a few minutes.", advance: "click" },
    { say: "Talk to the caller, then finish the call", advance: "done" },
  ],
  "first-outcome": [
    { target: "disposition-open", say: "Pick what happened on the call", detail: "The outcome moves the lead and books any callback.", advance: "done" },
  ],
  statements: [
    { say: "Open the latest statement and check the rows Insurvas couldn't match", advance: "done" },
  ],
  ledger: [
    { say: "See what was earned, advanced and charged back on each policy", advance: "done" },
  ],
};

/** The moves for a step. A step with no script gets one move: its instruction, waiting for its fact. */
/**
 * The small picture of the screen drawn beside each move on its Docs page (R4 D3, owner 2026-11-13): a sketch of the
 * page's shape with the one control lit, labelled with the move's own control. One per move, in order.
 */
export type GuideShot = "list" | "footer-button" | "toolbar-button" | "dialog" | "grid" | "table" | "row" | "upload" | "field" | "map" | "menu" | "check";

const SHOTS: Record<string, readonly GuideShot[]> = {
  carriers: ["list", "footer-button"],
  states: ["footer-button", "grid", "grid", "footer-button"],
  "lead-sources": ["toolbar-button", "dialog"],
  campaign: ["toolbar-button", "toolbar-button", "dialog"],
  import: ["upload", "footer-button", "table"],
  team: ["toolbar-button", "dialog"],
  "calling-windows": ["field", "footer-button"],
  assign: ["toolbar-button"],
  statement: ["toolbar-button", "upload", "dialog", "dialog", "dialog"],
  book: ["row", "dialog", "table"],
  outcomes: ["row", "map"],
  disclosures: ["table"],
  phone: ["field", "footer-button"],
  "queue-sla": ["table", "footer-button"],
  retention: ["row", "dialog"],
  compliance: ["table"],
  accounting: ["row", "dialog"],
  hierarchy: ["menu", "dialog"],
  "first-call": ["toolbar-button", "check"],
  "first-transfer": ["toolbar-button", "check"],
  "first-outcome": ["grid"],
  statements: ["table"],
  ledger: ["table"],
};

/** Every scripted step's pictures (for tests: one per move). */
export function guideShotsFor(key: string): readonly GuideShot[] {
  return SHOTS[key] ?? [];
}

/** The control a move names, for its picture's lit label: "Click Next: Set Up States" → "Next: Set Up States". */
export function shotLabel(say: string): string | null {
  const click = /(?:^|, then |, and )[Cc]lick (.+?)(?:,| on | then |$)/.exec(say);
  return click ? click[1] : null;
}

export function guideMovesFor(step: { key: string; instruction: string; target?: string }): readonly GuideMove[] {
  const moves = MOVES[step.key];
  const shots = SHOTS[step.key] ?? [];
  if (moves && moves.length > 0) return moves.map((move, at) => (shots[at] ? { ...move, shot: shots[at] } : move));
  return [{ ...(step.target ? { target: step.target } : {}), say: step.instruction, advance: "done", shot: "check" }];
}

/** Every scripted step key (for tests: each must be a real step). */
export function scriptedGuideSteps(): string[] {
  return Object.keys(MOVES);
}

/** Ready to sell: a counted step is required (no Skip, only Pause); a Fine-tune later step is optional. */
export function isRequiredStep(step: { optional?: boolean }): boolean {
  return step.optional !== true;
}

/**
 * Where the guide should be, given which move targets are on screen now. The current move stays while its
 * target is there (or it has none). If it is missing and a later move's target is present, jump to the
 * first such move: the person arrived mid-way (the set-up already on its second step, a dialog open).
 */
export function resolveMove(moves: readonly GuideMove[], current: number, present: (target: string) => boolean): number {
  if (current >= moves.length) return current;
  const move = moves[current];
  if (!move.target || present(move.target)) return current;
  for (let index = current + 1; index < moves.length; index += 1) {
    const later = moves[index].target;
    if (later && present(later)) return index;
  }
  return current;
}
