/**
 * Book of business and Carrier sync (owner 2026-11-02, round 2 of docs/la4/SIMPLIFY-PROPOSAL.md; split in two
 * 2026-11-05). Steps down a rail on the left, the step on the right (components/app/data-in/data-in-page.tsx):
 *
 *   Book of business
 *     Carrier files      every carrier file and its stages; a file and a row are detail pages under it
 *     Policies           the book; a policy is a detail page with tabs
 *     Commission ledger  every commission line (from Commissions)
 *   Carrier sync
 *     Needs you          one list of every decision a person must make (Lapse risk is a view of it)
 *     Rate card, Carrier rules, Pipeline rules, Agent codes, Files in   Setup's five tabs, each a step (2026-11-05)
 *
 * The older addresses stay: Policy matching and Exceptions open inside Needs you, Import your book inside
 * Setup, so every link, alert and email still lands. A plain module so the server frame, the client rail,
 * the sidebar and the page trail all read one list.
 */
/** The Book of business menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const DATA_IN_RAIL_COOKIE = "insurvas_data_in_rail";
/** The Carrier sync menu, the same way. */
export const SYNC_RAIL_COOKIE = "insurvas_carrier_sync_rail";

export const BOOK_AREA_LABEL = "Book of business";
export const SYNC_AREA_LABEL = "Carrier sync";

/**
 * Two areas since 2026-11-05 (owner: "on book of business … carrier files, policies … and also commission
 * ledger. So only these three"; everything that keeps the files in step with the book — Needs you and Setup —
 * is a new sidebar item, Carrier sync). One step list, each step in one area, so the frame, the rail, the
 * sidebar and the trail still read one list.
 */
export type DataInArea = "book" | "sync";
/** Setup's five tabs, each a Carrier sync step of its own since 2026-11-05 (owner: "remove setup … put rate card,
 * carrier rules, pipeline rules, agent codes, and files in … on the bar next to Needs you"). */
export type SetupStep = "rate-card" | "carrier-rules" | "pipeline-rules" | "agent-codes" | "files-in";
export const SETUP_STEP_KEYS: readonly SetupStep[] = ["rate-card", "carrier-rules", "pipeline-rules", "agent-codes", "files-in"];
export type DataInStep = "files" | "policies" | "ledger" | "needs-you" | SetupStep;

/** `icon`: the sidebar's own icon for the page, so the rail and the menu name it the same way. */
export const DATA_IN_STEPS: { key: DataInStep; area: DataInArea; label: string; href: string; icon: string }[] = [
  { key: "files", area: "book", label: "Carrier files", href: "/app/carrier-files", icon: "files" },
  { key: "policies", area: "book", label: "Policies", href: "/app/policies", icon: "book-user" },
  // From Commissions (owner 2026-11-05): the commission list sits beside the policy list.
  { key: "ledger", area: "book", label: "Commission ledger", href: "/app/ledger", icon: "receipt" },
  { key: "needs-you", area: "sync", label: "Needs you", href: "/app/needs-you", icon: "circle-alert" },
  { key: "rate-card", area: "sync", label: "Rate card", href: "/app/book-setup", icon: "calculator" },
  { key: "carrier-rules", area: "sync", label: "Carrier terms", href: "/app/book-setup/carrier-rules", icon: "shield-check" },
  { key: "pipeline-rules", area: "sync", label: "Card moves", href: "/app/book-setup/pipeline-rules", icon: "split" },
  { key: "agent-codes", area: "sync", label: "Agent codes", href: "/app/book-setup/agent-codes", icon: "user-round-search" },
  // How files arrive and Bring your existing book; /app/book-import renders it too.
  { key: "files-in", area: "sync", label: "Files in", href: "/app/book-setup/how-files-arrive", icon: "import" },
];

export const AREA_LABELS: Record<DataInArea, string> = { book: BOOK_AREA_LABEL, sync: SYNC_AREA_LABEL };
export const AREA_COOKIES: Record<DataInArea, string> = { book: DATA_IN_RAIL_COOKIE, sync: SYNC_RAIL_COOKIE };

export function areaOfStep(step: DataInStep): DataInArea {
  return DATA_IN_STEPS.find((item) => item.key === step)?.area ?? "book";
}

/** The steps of one area, in rail order. */
export function areaSteps(area: DataInArea) {
  return DATA_IN_STEPS.filter((item) => item.area === area);
}

/** Each step's own addresses, the older pages included. */
const STEP_PATHS: [RegExp, DataInStep][] = [
  [/^\/app\/carrier-files\/?$/, "files"],
  [/^\/app\/(needs-you|policy-matching|exceptions|lapse-risk)\/?$/, "needs-you"],
  [/^\/app\/policies\/?$/, "policies"],
  [/^\/app\/ledger\/?$/, "ledger"],
  [/^\/app\/book-setup\/?$/, "rate-card"],
  [/^\/app\/book-setup\/carrier-rules\/?$/, "carrier-rules"],
  [/^\/app\/book-setup\/pipeline-rules\/?$/, "pipeline-rules"],
  [/^\/app\/book-setup\/agent-codes\/?$/, "agent-codes"],
  [/^\/app\/(book-setup\/how-files-arrive|book-import)\/?$/, "files-in"],
];

/** The records that live under a step (a file, a row, an item, a policy, a rule): the same step, a detail page. */
const RECORD_PATHS: [RegExp, DataInStep][] = [
  [/^\/app\/carrier-files\/.+/, "files"],
  // Statements and a statement's own page (owner 2026-11-02: out of Commissions, under Files).
  [/^\/app\/statements(\/|$)/, "files"],
  [/^\/app\/needs-you\/.+/, "needs-you"],
  [/^\/app\/policies\/.+/, "policies"],
  // A carrier's rules, a pipeline rule, a new rule: records under their own step.
  [/^\/app\/book-setup\/carrier-rules\/.+/, "carrier-rules"],
  [/^\/app\/book-setup\/pipeline-rules\/.+/, "pipeline-rules"],
  // Files in's Email and Bucket pages (round 6).
  [/^\/app\/book-setup\/how-files-arrive\/.+/, "files-in"],
];

export function dataInStepOf(pathname: string): DataInStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

/** The step a page belongs to, a record's detail page included: the sidebar keeps the area lit on it. */
export function bookAreaOf(pathname: string): DataInStep | null {
  return dataInStepOf(pathname) ?? RECORD_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

/** The area a page belongs to (Book of business or Carrier sync), a record's detail page included. */
export function dataInAreaOf(pathname: string): DataInArea | null {
  const step = bookAreaOf(pathname);
  return step ? areaOfStep(step) : null;
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
  // Setup's tab counts, now on the rail (lib/pipelineRules/setupCounts.ts).
  "rate-card": ["carrier missing a rate", "carriers missing a rate"],
  "carrier-rules": ["window not set", "windows not set"],
  "agent-codes": ["agent code to map", "agent codes to map"],
};
