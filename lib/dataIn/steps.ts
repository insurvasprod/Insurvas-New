/**
 * Book of business, one area (owner 2026-11-02, round 2 of docs/la4/SIMPLIFY-PROPOSAL.md; it was "Data in"
 * the same morning). Four steps down a rail on the left, the step on the right
 * (components/app/data-in/data-in-page.tsx):
 *
 *   Files      every carrier file and its eight stages; a file and a row are detail pages under it
 *   Needs you  one list of every decision a person must make; each item is a detail page
 *   Policies   the book; a policy is a detail page with tabs
 *   Setup      rate card, carrier rules, pipeline rules, agent codes, bringing your existing book
 *
 * The older addresses stay: Policy matching and Exceptions open inside Needs you, Import your book inside
 * Setup, so every link, alert and email still lands. A plain module so the server frame, the client rail,
 * the sidebar and the page trail all read one list.
 */
/** The Book of business menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const DATA_IN_RAIL_COOKIE = "insurvas_data_in_rail";

export const BOOK_AREA_LABEL = "Book of business";

export type DataInStep = "files" | "needs-you" | "policies" | "setup";

/** `icon`: the sidebar's own icon for the page, so the rail and the menu name it the same way. */
export const DATA_IN_STEPS: { key: DataInStep; label: string; href: string; icon: string }[] = [
  { key: "files", label: "Files", href: "/app/carrier-files", icon: "files" },
  { key: "needs-you", label: "Needs you", href: "/app/needs-you", icon: "circle-alert" },
  { key: "policies", label: "Policies", href: "/app/policies", icon: "book-user" },
  { key: "setup", label: "Setup", href: "/app/book-setup", icon: "settings" },
];

/** Each step's own addresses, the older pages included. */
const STEP_PATHS: [RegExp, DataInStep][] = [
  [/^\/app\/carrier-files\/?$/, "files"],
  [/^\/app\/(needs-you|policy-matching|exceptions)\/?$/, "needs-you"],
  [/^\/app\/policies\/?$/, "policies"],
  [/^\/app\/(book-setup(\/[a-z-]+)?|book-import)\/?$/, "setup"],
];

/** The records that live under a step (a file, a row, an item, a policy, a rule): the same step, a detail page. */
const RECORD_PATHS: [RegExp, DataInStep][] = [
  [/^\/app\/carrier-files\/.+/, "files"],
  // Statements and a statement's own page (owner 2026-11-02: out of Commissions, under Files).
  [/^\/app\/statements(\/|$)/, "files"],
  [/^\/app\/needs-you\/.+/, "needs-you"],
  [/^\/app\/policies\/.+/, "policies"],
  [/^\/app\/book-setup\/.+/, "setup"],
];

export function dataInStepOf(pathname: string): DataInStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

/** The step a page belongs to, a record's detail page included: the sidebar keeps the area lit on it. */
export function bookAreaOf(pathname: string): DataInStep | null {
  return dataInStepOf(pathname) ?? RECORD_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function dataInStepLabel(step: DataInStep): string {
  return DATA_IN_STEPS.find((item) => item.key === step)?.label ?? "";
}

/** What waits on a person per step (/api/app/data-in/steps); a step left out has no badge. */
export type DataInStepCounts = Partial<Record<DataInStep, number>>;

/** What each badge counts (/api/app/data-in/steps), one and many. Policies has no queue, so no badge. */
export const DATA_IN_WAITING: Record<string, [string, string]> = {
  files: ["file could not be read", "files could not be read"],
  "needs-you": ["thing waiting for you to decide", "things waiting for you to decide"],
  setup: ["carrier missing a rule or rate", "carriers missing a rule or rate"],
};
