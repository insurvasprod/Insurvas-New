/**
 * Carrier commission statements: the shapes and constants the import dialog, the review screen,
 * the ledger page and the API share.
 *
 * Plain module, no server-only imports: the "use client" components import from here. The
 * database access lives in ./statementService (server-only); the pure rules in ./statementParse
 * and ./statementMatch.
 */

export const STATEMENT_LINE_KINDS = ["advance", "commission", "chargeback", "adjustment"] as const;
export type StatementLineKind = (typeof STATEMENT_LINE_KINDS)[number];

export const STATEMENT_KIND_LABELS: Record<StatementLineKind, string> = {
  advance: "Advance",
  commission: "Commission",
  chargeback: "Chargeback",
  adjustment: "Adjustment",
};

/** The columns a statement is read by. Policy number and amount are required; the rest help. */
/**
 * The columns a statement is read by. Policy number and amount are required; the rest help. Premium
 * and rate (LA-4.3) are what "paid at the wrong rate" is judged on when a carrier sends them.
 */
export const STATEMENT_FIELDS = ["policyNumber", "amount", "kind", "lineDate", "insuredName", "premium", "rate"] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];
export const REQUIRED_STATEMENT_FIELDS: readonly StatementField[] = ["policyNumber", "amount"];

export const STATEMENT_FIELD_LABELS: Record<StatementField, { label: string; hint: string }> = {
  policyNumber: { label: "Policy number", hint: "Matched to your book, with the carrier" },
  amount: { label: "Amount", hint: "Paid, advanced or charged back on this line" },
  kind: { label: "Kind", hint: "Advance, commission, chargeback or adjustment. Without it, a negative amount is a chargeback and a positive one commission" },
  lineDate: { label: "Date", hint: "When the carrier paid or charged it. Without it, the line posts on the last day of the period" },
  insuredName: { label: "Insured", hint: "Shown beside the line, and used to propose a match when no policy number matches" },
  premium: { label: "Premium", hint: "The premium the commission was paid on, when the carrier shows it" },
  rate: { label: "Rate", hint: "The commission rate paid, like 110% or 1.10, when the carrier shows it" },
};

/** Field → the file's column header. */
export type StatementMapping = Partial<Record<StatementField, string>>;

/** Bounds one import transaction; the database function refuses more. */
export const MAX_STATEMENT_LINES = 10_000;
/** The CSV parser's own ceiling (lib/contacts/csv.ts). */
export const MAX_STATEMENT_BYTES = 5_000_000;
/**
 * The largest statement FILE accepted (LA-4.1), CSV, Excel or PDF. It travels in one request body,
 * so it stays under a serverless host's ~4.5 MB request limit with room for the form fields.
 */
export const MAX_STATEMENT_FILE_BYTES = 4_000_000;

export const STATEMENT_FILE_KINDS = ["csv", "xlsx", "pdf"] as const;
export type StatementFileKind = (typeof STATEMENT_FILE_KINDS)[number];

/** Before migration 20261002100000 (LA-4.1–4.3): CSV still imports, the rest waits. */
export const STATEMENT_FILES_PENDING_MESSAGE =
  "Keeping statement files, PDF statements, name matching and re-processing need a database update. Until it is applied, CSV statements import as before.";

/**
 * A reported total within this many cents of the expected one reads as agreeing. Carriers round
 * each line and the ledger rounds each year, so a few cents apart on a policy is arithmetic, not a
 * discrepancy; a dollar is the smallest difference worth a person's time.
 */
export const RECONCILE_TOLERANCE_CENTS = 100;

/** Before migrations 20260924260000 and 20260924260100 are applied. */
export const STATEMENT_SCHEMA_PENDING_MESSAGE =
  "Carrier statement import needs a database update. Until it is applied, statements cannot be imported and the ledger shows expected commission only.";

export type StatementStatus = "awaiting_entry" | "review" | "reviewed" | "voided";
export type StatementLineReview = "proposed" | "accepted" | "unmatched" | "left_unmatched" | "error";

export type StatementCarrierOption = { id: string; code: string; name: string };

/** One row of the statement history. */
export type StatementSummary = {
  id: string;
  carrierId: string;
  carrierName: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  rowCount: number;
  status: StatementStatus;
  uploadedAt: string;
  uploadedByName: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  counts: { lines: number; accepted: number; proposed: number; unmatched: number; leftUnmatched: number; errors: number };
  acceptedCents: number;
  statementCents: number;
  /** LA-4.1: what the original was, and whether it is stored. "csv" with no file before the migration. */
  fileKind: StatementFileKind;
  hasFile: boolean;
  sheetName: string | null;
  /** The statement this one re-read, and the one that re-read it (LA-4.3). */
  reprocessedFrom: string | null;
  headers: string[];
  mapping: StatementMapping;
};

export type StatementPolicyRef = { id: string; policyNumber: string; insuredName: string; carrier: string };

/** One line on the review screen. */
export type StatementLineView = {
  id: string;
  lineNumber: number;
  raw: Record<string, string>;
  policyNumber: string | null;
  insuredName: string | null;
  amountCents: number | null;
  kind: StatementLineKind | null;
  lineDate: string | null;
  parseError: string | null;
  review: StatementLineReview;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** The live match: proposed or accepted. Null when unmatched. */
  match: { id: string; method: MatchMethod; status: "proposed" | "accepted"; policy: StatementPolicyRef | null; acceptedByName: string | null; acceptedAt: string | null } | null;
  /** Read from the file, or typed in from a PDF (LA-4.2). */
  entrySource: "file" | "manual";
  premiumCents: number | null;
  rateBp: number | null;
};

/** How a match was made: the policy number, the insured name (LA-4.3), or by hand. */
export type MatchMethod = "exact" | "name" | "manual";

/** What the preview step shows before anything is written. */
export type StatementPreview = {
  headers: string[];
  totalLines: number;
  errorLines: number;
  proposedLines: number;
  unmatchedLines: number;
  netCents: number;
  sample: Array<{
    lineNumber: number;
    policyNumber: string | null;
    insuredName: string | null;
    amountCents: number | null;
    kind: StatementLineKind | null;
    kindFrom: "column" | "sign" | null;
    lineDate: string | null;
    error: string | null;
    proposal: StatementPolicyRef | null;
    proposalMethod: "exact" | "name" | null;
    reason: string;
  }>;
  duplicate: { statementId: string; uploadedAt: string; uploadedByName: string | null } | null;
};

/** A statement line that posts to the ledger: accepted, on a statement that is not voided. */
export type StatementLedgerEntry = {
  id: string;
  statementId: string;
  carrierName: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  lineNumber: number;
  postedOn: string;
  kind: StatementLineKind;
  amountCents: number;
  policyId: string;
  policyNumber: string;
  insuredName: string;
  producerUserId: string | null;
  method: MatchMethod;
  acceptedByName: string | null;
  acceptedAt: string;
};

/** Any 8-4-4-4-12 hex id. Seeded rows are not always RFC 4122, so this is looser than z.uuid(). */
export const isRecordId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// ── formatting, the ledger page's conventions ────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15 Aug 2026" from YYYY-MM-DD (or the date part of a timestamp). */
export function statementDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

/** "Aug 2026" for a whole calendar month; otherwise "1 Aug – 15 Aug 2026". */
export function statementPeriod(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  if (sy === ey && sm === em && sd === 1 && ed === lastDay) return `${MONTHS[sm - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]}${sy === ey ? "" : ` ${sy}`} – ${statementDay(end)}`;
}

/** "−$1,234.56". */
export function statementMoney(cents: number): string {
  return `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A line typed in from a PDF statement (LA-4.2), as the entry grid sends it. */
export type ManualStatementLine = {
  policyNumber: string;
  insuredName?: string;
  amount: string;
  kind?: StatementLineKind | "";
  lineDate?: string;
};

/** One line in the cross-statement unmatched queue (LA-4.3). */
export type UnmatchedStatementLine = {
  id: string;
  statementId: string;
  carrierName: string;
  periodStart: string;
  periodEnd: string;
  lineNumber: number;
  policyNumber: string | null;
  insuredName: string | null;
  amountCents: number | null;
  kind: StatementLineKind | null;
};

export type StatementLineDecision =
  | { line_id: string; action: "accept" | "reject" | "leave_unmatched" }
  | { line_id: string; action: "match"; policy_id: string };
