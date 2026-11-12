/**
 * Commissions › Statements, the list's tabs and order in one place (round 7, owner pick 1·A, 2026-11-10;
 * docs/la4/mockups-r7/commissions.html boards 1·A–1·4). The list draws with it, and a statement page's ‹ › walk
 * the same list (the tab rides along as `?from=`). Pure: no server, no React.
 */
import type { StatementLineReview, StatementLineView, StatementSummary } from "@/lib/ledger/statementConstants";

/** The tabs on the title line: what is left to do first. */
export type StatementsView = "review" | "unmatched" | "reviewed" | "voided";
export const STATEMENT_VIEWS: Array<{ key: StatementsView; label: string }> = [
  { key: "review", label: "To review" },
  { key: "unmatched", label: "Lines to match" },
  { key: "reviewed", label: "Reviewed" },
  { key: "voided", label: "Voided" },
];

export const parseStatementsView = (value: string | null | undefined): StatementsView =>
  STATEMENT_VIEWS.some((view) => view.key === value) ? (value as StatementsView) : "review";

/** The list's address for a tab (To review is the bare address). */
export const statementsViewHref = (view: StatementsView, extra?: Record<string, string>) => {
  const query = new URLSearchParams({ ...(view === "review" ? {} : { view }), ...(extra ?? {}) }).toString();
  return `/app/statements${query ? `?${query}` : ""}`;
};

type Counted = Pick<StatementSummary, "status" | "counts">;
const waitingOf = (statement: Counted) => statement.counts.proposed + statement.counts.unmatched;

/**
 * To review: a line waits for a person, a line could not be read, or a PDF's lines wait to be typed in. A statement
 * with unreadable lines stays here until it is re-processed or voided (critique 1·0: LA14 Market read "Reviewed"
 * with nothing accepted).
 */
export function needsReview(statement: Counted): boolean {
  if (statement.status === "voided") return false;
  return statement.status === "awaiting_entry" || waitingOf(statement) > 0 || statement.counts.errors > 0;
}

/** The tab a statement sits on (Lines to match is a view of lines, so a statement is never "on" it). */
export const statementTabOf = (statement: Counted): Exclude<StatementsView, "unmatched"> =>
  statement.status === "voided" ? "voided" : needsReview(statement) ? "review" : "reviewed";

/** The statements a tab lists, in its order: oldest first while there is work, newest first once done. */
export function statementsOn<T extends Counted & Pick<StatementSummary, "uploadedAt">>(statements: T[], view: StatementsView): T[] {
  const these = view === "unmatched"
    ? statements.filter((statement) => statement.status !== "voided" && statement.counts.unmatched > 0)
    : statements.filter((statement) => statementTabOf(statement) === view);
  const oldestFirst = view === "review" || view === "unmatched";
  return [...these].sort((a, b) => (oldestFirst ? a.uploadedAt.localeCompare(b.uploadedAt) : b.uploadedAt.localeCompare(a.uploadedAt)));
}

/** The counts on the tabs. Lines to match counts lines, the others statements. */
export function statementViewCounts(statements: Counted[]): Record<StatementsView, number> {
  const counts: Record<StatementsView, number> = { review: 0, unmatched: 0, reviewed: 0, voided: 0 };
  for (const statement of statements) {
    counts[statementTabOf(statement)] += 1;
    if (statement.status !== "voided") counts.unmatched += statement.counts.unmatched;
  }
  return counts;
}

/** The statements either side of one, in the list's order. */
export function statementNeighbours<T extends { id: string }>(ordered: T[], id: string): { previous: T | null; next: T | null } {
  const at = ordered.findIndex((row) => row.id === id);
  if (at < 0) return { previous: null, next: null };
  return { previous: ordered[at - 1] ?? null, next: ordered[at + 1] ?? null };
}

/**
 * "Next step" in words, never a button (board 1·A): what a person does on the statement next.
 * `canReprocess`: the stored original can be read again with other columns.
 */
export function statementNextStep(statement: Counted & Pick<StatementSummary, "fileKind" | "hasFile" | "headers">, readOnly: boolean): { text: string; tone?: "danger"; tab?: StatementTab } {
  const n = (value: number, one: string, many: string) => `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;
  if (statement.status === "voided") return { text: "Voided · open it ›" };
  if (readOnly) return { text: "Open ›" };
  if (statement.status === "awaiting_entry") return { text: "Type in its lines ›" };
  if (statement.counts.proposed > 0) return { text: `Accept ${statement.counts.proposed.toLocaleString("en-US")} proposed ›` };
  if (statement.counts.unmatched > 0) return { text: `Match ${n(statement.counts.unmatched, "line", "lines")} ›` };
  if (statement.counts.errors > 0) {
    const canReprocess = statement.hasFile && statement.fileKind !== "pdf" && statement.headers.length > 0;
    return canReprocess ? { text: "Re-process with other columns ›", tone: "danger", tab: "aside" } : { text: `See ${n(statement.counts.errors, "unreadable line", "unreadable lines")} ›`, tone: "danger", tab: "aside" };
  }
  return { text: "Open ›" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The days a statement covers: "1–31 Oct 2026" inside one month, else "28 Sep – 27 Oct 2026". */
export function statementSpan(start: string, end: string): string {
  const [sy, sm, sd] = start.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = end.slice(0, 10).split("-").map(Number);
  if (!sy || !ey) return `${start} – ${end}`;
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]}${sy === ey ? "" : ` ${sy}`} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}

/** A carrier's statement by name: "American Amicable · Oct 2026". */
export const statementName = (carrierName: string, period: string) => `${carrierName} · ${period}`;

/**
 * A policy number as the carrier meant it: Excel's text guard (`="D674578782"`) taken off, so it reads and searches
 * as the number (critique 1·0).
 */
export function cleanPolicyNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  const guarded = /^="(.*)"$/.exec(trimmed);
  return guarded ? guarded[1].trim() : trimmed;
}

/** The statement page's tabs. */
export type StatementTab = "waiting" | "accepted" | "aside" | "file";
export const STATEMENT_TABS: StatementTab[] = ["waiting", "accepted", "aside", "file"];
/** Which lines each of the statement page's line tabs holds. A plain module, so the server page counts them too. */
export const STATEMENT_TAB_HOLDS: Record<Exclude<StatementTab, "file">, (review: StatementLineReview) => boolean> = {
  waiting: (review) => review === "proposed" || review === "unmatched",
  accepted: (review) => review === "accepted",
  aside: (review) => review === "left_unmatched" || review === "error",
};
export const statementTabCount = (lines: StatementLineView[], tab: Exclude<StatementTab, "file">) => lines.filter((line) => STATEMENT_TAB_HOLDS[tab](line.review)).length;
export const parseStatementTab = (value: string | null | undefined): StatementTab =>
  STATEMENT_TABS.includes(value as StatementTab) ? (value as StatementTab) : "waiting";

/** The statement page, carrying the list it was opened from (its ‹ › walk that list). */
export function statementHref(id: string, from: StatementsView, extra?: { tab?: StatementTab; line?: string }) {
  const query = new URLSearchParams({ ...(extra?.tab && extra.tab !== "waiting" ? { tab: extra.tab } : {}), ...(extra?.line ? { line: extra.line } : {}), from });
  return `/app/statements/${id}?${query}`;
}

/** The carrier's original file: opens it (a 60-second link), or saves it under its own name. */
export const statementFileHref = (id: string, download = false) => `/api/app/statements/${id}/file?open=1${download ? "&download=1" : ""}`;
