import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { dayMonthYear } from "@/lib/format/dates";
import { readXlsxAsCsv } from "@/lib/agentTemplates/xlsx";
import { refreshDiscrepanciesQuietly } from "@/lib/discrepancies/service";
import {
  STATEMENT_FILES_PENDING_MESSAGE,
  STATEMENT_SCHEMA_PENDING_MESSAGE,
  STATEMENT_FILE_KINDS,
  type ManualStatementLine,
  type MatchMethod,
  type StatementCarrierOption,
  type StatementFileKind,
  type StatementLedgerEntry,
  type StatementLineDecision,
  type StatementLineKind,
  type StatementLineReview,
  type StatementLineView,
  type StatementMapping,
  type StatementPolicyRef,
  type StatementPreview,
  type StatementStatus,
  type StatementSummary,
  type UnmatchedStatementLine,
} from "./statementConstants";
import { STATEMENT_BUCKET, STATEMENT_CONTENT_TYPE, statementBytesMatch, statementStoragePath } from "./statementFile";
import { parseAmountCents, parseStatementCsv, parseStatementDate, parseStatementKind, sanitizeStatementMapping, readStatementHeaders, type ParsedStatement, type ParsedStatementLine } from "./statementParse";
import { proposeExactMatches, proposeFallbackMatches, type MatchCarrier, type MatchProposal } from "./statementMatch";

/**
 * Carrier commission statements: the database side.
 *
 * Tables and functions come from migrations 20260924260000 (tables, views) and 20260924260100
 * (import_commission_statement, decide_commission_statement_lines). Before they are applied every
 * read answers `available: false` and every write throws StatementSchemaPendingError, which the
 * routes turn into a 503 and the pages into a sentence.
 *
 * Nothing here decides who may call it. The routes and pages check the role and the feature first
 * (owner or bookkeeper for statements; the ledger's own scoping for statement entries, through the
 * `canView` the caller passes, exactly as getCommissionLedger does).
 */

type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };
type Result<T = unknown> = { data: T; error: DbError | null };
type Query = PromiseLike<Result> & {
  select(columns: string, options?: unknown): Query;
  eq(column: string, value: unknown): Query;
  neq(column: string, value: unknown): Query;
  is(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  order(column: string, options?: unknown): Query;
  range(from: number, to: number): Query;
  update(values: unknown): Query;
  maybeSingle<T = unknown>(): Promise<Result<T>>;
};
type Storage = {
  from(bucket: string): {
    upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: DbError | null }>;
    download(path: string): Promise<{ data: Blob | null; error: DbError | null }>;
    remove(paths: string[]): Promise<{ error: DbError | null }>;
    createSignedUrl(path: string, seconds: number, options?: { download?: string | boolean }): Promise<{ data: { signedUrl: string } | null; error: DbError | null }>;
  };
};
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): Promise<Result>; storage: Storage };

const db = () => getSupabaseServiceClient() as unknown as Db;
const PAGE = 1000;

export class StatementSchemaPendingError extends Error {
  constructor(message = STATEMENT_SCHEMA_PENDING_MESSAGE) { super(message); this.name = "StatementSchemaPendingError"; }
}

/** A refusal with a status and a sentence the person can act on. */
export class StatementError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "StatementError"; }
}

/** A missing table/column (schemaGap) or a missing function (42883 / PGRST202). */
function isPending(error: DbError | null | undefined): boolean {
  if (!error) return false;
  return isSchemaGap(error) || ["42883", "PGRST202"].includes(error.code ?? "") || /could not find the function/i.test(error.message);
}

async function readAll<T>(build: () => Query): Promise<{ rows: T[]; error: DbError | null }> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const page = await build().range(start, start + PAGE - 1);
    if (page.error) return { rows, error: page.error };
    const data = (page.data ?? []) as T[];
    rows.push(...data);
    if (data.length < PAGE) return { rows, error: null };
  }
}

async function namesOf(userIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const result = await db().from("users").select("id, name").in("id", ids);
  if (result.error) throw new Error(`Could not load user names: ${result.error.message}`);
  return new Map(((result.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
}

async function carriersById(ids: string[]): Promise<Map<string, MatchCarrier>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const result = await db().from("carriers").select("id, code, name").in("id", unique);
  if (result.error) throw new Error(`Could not load carriers: ${result.error.message}`);
  return new Map(((result.data ?? []) as MatchCarrier[]).map((row) => [row.id, row]));
}

/** The platform carrier library, for the import dialog's carrier choice. */
export async function listStatementCarriers(): Promise<StatementCarrierOption[]> {
  const result = await db().from("carriers").select("id, code, name").is("organization_id", null).eq("is_active", true).order("sort_order").order("name");
  if (result.error) throw new Error(`Could not load carriers: ${result.error.message}`);
  return (result.data ?? []) as StatementCarrierOption[];
}

type PolicyRow = { id: string; policy_number: string; insured_name: string; carrier: string; created_by: string | null };

/** Every policy in the book, paged past PostgREST's row cap. */
async function readPolicies(tenantId: string): Promise<PolicyRow[]> {
  const { rows, error } = await readAll<PolicyRow>(() =>
    db().from("tenant_policies").select("id, policy_number, insured_name, carrier, created_by").eq("tenant_id", tenantId).order("policy_number"),
  );
  if (error) throw new Error(`Could not load policies: ${error.message}`);
  return rows;
}

const policyRef = (row: PolicyRow): StatementPolicyRef => ({ id: row.id, policyNumber: row.policy_number, insuredName: row.insured_name, carrier: row.carrier });

/** The book as the manual-match picker needs it. */
export async function listPolicyRefs(tenantId: string): Promise<StatementPolicyRef[]> {
  return (await readPolicies(tenantId)).map(policyRef);
}

/** The column mapping last used for each carrier. Empty before the migration. */
export async function getSavedStatementMappings(tenantId: string): Promise<Record<string, StatementMapping>> {
  const result = await db().from("tenant_statement_column_mappings").select("carrier_id, mapping").eq("tenant_id", tenantId);
  if (result.error) {
    if (isPending(result.error)) return {};
    throw new Error(`Could not load statement mappings: ${result.error.message}`);
  }
  return Object.fromEntries(((result.data ?? []) as Array<{ carrier_id: string; mapping: StatementMapping }>).map((row) => [row.carrier_id, row.mapping]));
}

// ── reads ──────────────────────────────────────────────────────────────────────

type StatementRow = {
  id: string; carrier_id: string; period_start: string; period_end: string; original_filename: string; row_count: number;
  status: StatementStatus; uploaded_by: string | null; uploaded_at: string; void_reason: string | null; voided_by: string | null; voided_at: string | null;
  headers?: string[] | null; column_mapping?: StatementMapping | null;
  // LA-4.1 (20261002100000). Absent before that migration; the read retries without them.
  file_kind?: StatementFileKind | null; storage_path?: string | null; sheet_name?: string | null; reprocessed_from?: string | null;
};
type SummaryRow = {
  statement_id: string; status: StatementStatus; line_count: number; accepted_count: number; proposed_count: number; unmatched_count: number;
  left_unmatched_count: number; error_count: number; accepted_cents: number | string; statement_cents: number | string;
};
const STATEMENT_COLUMNS_V1 = "id, carrier_id, period_start, period_end, original_filename, row_count, status, uploaded_by, uploaded_at, void_reason, voided_by, voided_at, headers, column_mapping";
const STATEMENT_COLUMNS = `${STATEMENT_COLUMNS_V1}, file_kind, storage_path, sheet_name, reprocessed_from`;

/** A read with the LA-4 columns, retried without them on a database the migration has not reached. */
async function withStatementColumns<T extends { error: DbError | null }>(read: (columns: string) => PromiseLike<T>): Promise<T> {
  const first = await read(STATEMENT_COLUMNS);
  if (first.error && isSchemaGap(first.error)) return read(STATEMENT_COLUMNS_V1);
  return first;
}

function summarise(row: StatementRow, summary: SummaryRow | undefined, carriers: Map<string, MatchCarrier>, names: Map<string, string>): StatementSummary {
  return {
    id: row.id,
    carrierId: row.carrier_id,
    carrierName: carriers.get(row.carrier_id)?.name ?? "Unknown carrier",
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fileName: row.original_filename,
    rowCount: row.row_count,
    status: row.status,
    uploadedAt: row.uploaded_at,
    uploadedByName: row.uploaded_by ? names.get(row.uploaded_by) ?? null : null,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedByName: row.voided_by ? names.get(row.voided_by) ?? null : null,
    counts: {
      lines: summary?.line_count ?? 0,
      accepted: summary?.accepted_count ?? 0,
      proposed: summary?.proposed_count ?? 0,
      unmatched: summary?.unmatched_count ?? 0,
      leftUnmatched: summary?.left_unmatched_count ?? 0,
      errors: summary?.error_count ?? 0,
    },
    acceptedCents: Number(summary?.accepted_cents ?? 0),
    statementCents: Number(summary?.statement_cents ?? 0),
    fileKind: row.file_kind && (STATEMENT_FILE_KINDS as readonly string[]).includes(row.file_kind) ? row.file_kind : "csv",
    hasFile: Boolean(row.storage_path),
    sheetName: row.sheet_name ?? null,
    reprocessedFrom: row.reprocessed_from ?? null,
    headers: Array.isArray(row.headers) ? row.headers : [],
    mapping: row.column_mapping && typeof row.column_mapping === "object" ? row.column_mapping : {},
  };
}

export async function listStatements(tenantId: string): Promise<{ available: boolean; statements: StatementSummary[] }> {
  const [statements, summaries] = await Promise.all([
    withStatementColumns((columns) => readAll<StatementRow>(() => db().from("tenant_commission_statements").select(columns).eq("tenant_id", tenantId).order("uploaded_at", { ascending: false }))),
    readAll<SummaryRow>(() => db().from("tenant_commission_statement_summaries").select("*").eq("tenant_id", tenantId).order("statement_id")),
  ]);
  const error = statements.error ?? summaries.error;
  if (error) {
    if (isPending(error)) return { available: false, statements: [] };
    throw new Error(`Could not load statements: ${error.message}`);
  }
  const [carriers, names] = await Promise.all([
    carriersById(statements.rows.map((row) => row.carrier_id)),
    namesOf(statements.rows.flatMap((row) => [row.uploaded_by, row.voided_by])),
  ]);
  const byId = new Map(summaries.rows.map((row) => [row.statement_id, row]));
  return { available: true, statements: statements.rows.map((row) => summarise(row, byId.get(row.id), carriers, names)) };
}

type LineRow = {
  id: string; line_number: number; raw: Record<string, string>; policy_number: string | null; insured_name: string | null; amount_cents: number | string | null;
  kind: StatementLineKind | null; line_date: string | null; parse_error: string | null; review_status: StatementLineReview; reviewed_by: string | null; reviewed_at: string | null;
  matches: Array<{ id: string; policy_id: string; method: MatchMethod; status: "proposed" | "accepted" | "rejected"; accepted_by: string | null; accepted_at: string | null }> | null;
  entry_source?: "file" | "manual" | null; premium_cents?: number | string | null; rate_bp?: number | null;
};
const LINE_COLUMNS_V1 = "id, line_number, raw, policy_number, insured_name, amount_cents, kind, line_date, parse_error, review_status, reviewed_by, reviewed_at, matches:tenant_commission_statement_matches(id, policy_id, method, status, accepted_by, accepted_at)";
const LINE_COLUMNS = `${LINE_COLUMNS_V1}, entry_source, premium_cents, rate_bp`;

export type StatementDetail = { statement: StatementSummary; lines: StatementLineView[]; carrier: MatchCarrier | null; policies: StatementPolicyRef[] };

/** One statement with every line and its live match. Null when it is not this tenant's. */
export async function getStatementDetail(tenantId: string, statementId: string): Promise<{ available: boolean; detail: StatementDetail | null }> {
  const statement = await withStatementColumns((columns) => db().from("tenant_commission_statements").select(columns).eq("tenant_id", tenantId).eq("id", statementId).maybeSingle<StatementRow>());
  if (statement.error) {
    if (isPending(statement.error)) return { available: false, detail: null };
    throw new Error(`Could not load the statement: ${statement.error.message}`);
  }
  if (!statement.data) return { available: true, detail: null };
  const row = statement.data;

  const [summary, lines, policies] = await Promise.all([
    db().from("tenant_commission_statement_summaries").select("*").eq("tenant_id", tenantId).eq("statement_id", statementId).maybeSingle<SummaryRow>(),
    (async () => {
      const read = (columns: string) => readAll<LineRow>(() => db().from("tenant_commission_statement_lines").select(columns).eq("tenant_id", tenantId).eq("statement_id", statementId).order("line_number"));
      const first = await read(LINE_COLUMNS);
      return first.error && isSchemaGap(first.error) ? read(LINE_COLUMNS_V1) : first;
    })(),
    readPolicies(tenantId),
  ]);
  const error = summary.error ?? lines.error;
  if (error) {
    if (isPending(error)) return { available: false, detail: null };
    throw new Error(`Could not load the statement lines: ${error.message}`);
  }

  const live = (line: LineRow) => (line.matches ?? []).find((match) => match.status !== "rejected") ?? null;
  const [carriers, names] = await Promise.all([
    carriersById([row.carrier_id]),
    namesOf([row.uploaded_by, row.voided_by, ...lines.rows.flatMap((line) => [line.reviewed_by, live(line)?.accepted_by])]),
  ]);
  const policyById = new Map(policies.map((policy) => [policy.id, policyRef(policy)]));

  const views: StatementLineView[] = lines.rows.map((line) => {
    const match = live(line);
    return {
      id: line.id,
      lineNumber: line.line_number,
      raw: line.raw ?? {},
      policyNumber: line.policy_number,
      insuredName: line.insured_name,
      amountCents: line.amount_cents === null ? null : Number(line.amount_cents),
      kind: line.kind,
      lineDate: line.line_date,
      parseError: line.parse_error,
      review: line.review_status,
      reviewedByName: line.reviewed_by ? names.get(line.reviewed_by) ?? null : null,
      reviewedAt: line.reviewed_at,
      match: match && match.status !== "rejected"
        ? { id: match.id, method: match.method, status: match.status, policy: policyById.get(match.policy_id) ?? null, acceptedByName: match.accepted_by ? names.get(match.accepted_by) ?? null : null, acceptedAt: match.accepted_at }
        : null,
      entrySource: line.entry_source === "manual" ? "manual" : "file",
      premiumCents: line.premium_cents === null || line.premium_cents === undefined ? null : Number(line.premium_cents),
      rateBp: line.rate_bp ?? null,
    };
  });

  return {
    available: true,
    detail: { statement: summarise(row, summary.data ?? undefined, carriers, names), lines: views, carrier: carriers.get(row.carrier_id) ?? null, policies: policies.map(policyRef) },
  };
}

type EntryRow = {
  line_id: string; statement_id: string; carrier_id: string; period_start: string; period_end: string; original_filename: string; line_number: number;
  amount_cents: number | string; kind: StatementLineKind; posted_on: string; policy_id: string; method: MatchMethod; accepted_by: string | null; accepted_at: string;
};

export type StatementLedger = {
  available: boolean;
  entries: StatementLedgerEntry[];
  /** Statements imported and not voided. */
  statementsImported: number;
  /** Lines still waiting for a person, and the statements they are on. */
  awaitingReview: { statements: number; lines: number };
};

/**
 * What carriers reported, as it posts to the ledger: accepted lines on statements that are not
 * voided. `canView` is asked about each matched policy's producer, the same question
 * getCommissionLedger asks, so a producer sees only the lines matched to their own policies.
 */
export async function getStatementLedger(input: { tenantId: string; canView: (producerUserId: string | undefined) => boolean }): Promise<StatementLedger> {
  const empty: StatementLedger = { available: false, entries: [], statementsImported: 0, awaitingReview: { statements: 0, lines: 0 } };
  const [entries, summaries] = await Promise.all([
    readAll<EntryRow>(() =>
      db().from("tenant_commission_statement_entries")
        .select("line_id, statement_id, carrier_id, period_start, period_end, original_filename, line_number, amount_cents, kind, posted_on, policy_id, method, accepted_by, accepted_at")
        .eq("tenant_id", input.tenantId).order("posted_on", { ascending: false }).order("line_id"),
    ),
    readAll<SummaryRow>(() => db().from("tenant_commission_statement_summaries").select("statement_id, status, proposed_count, unmatched_count").eq("tenant_id", input.tenantId).order("statement_id")),
  ]);
  const error = entries.error ?? summaries.error;
  if (error) {
    if (isPending(error)) return empty;
    throw new Error(`Could not load statement entries: ${error.message}`);
  }

  const standing = summaries.rows.filter((row) => row.status !== "voided");
  const waiting = standing.filter((row) => row.proposed_count + row.unmatched_count > 0);
  const base = {
    available: true,
    statementsImported: standing.length,
    awaitingReview: { statements: waiting.length, lines: waiting.reduce((total, row) => total + row.proposed_count + row.unmatched_count, 0) },
  };
  if (!entries.rows.length) return { ...base, entries: [] };

  const [policies, carriers, names] = await Promise.all([
    readPolicies(input.tenantId),
    carriersById(entries.rows.map((row) => row.carrier_id)),
    namesOf(entries.rows.map((row) => row.accepted_by)),
  ]);
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));

  const visible: StatementLedgerEntry[] = [];
  for (const row of entries.rows) {
    const policy = policyById.get(row.policy_id);
    if (!policy || !input.canView(policy.created_by ?? undefined)) continue;
    visible.push({
      id: row.line_id,
      statementId: row.statement_id,
      carrierName: carriers.get(row.carrier_id)?.name ?? "Unknown carrier",
      periodStart: row.period_start,
      periodEnd: row.period_end,
      fileName: row.original_filename,
      lineNumber: row.line_number,
      postedOn: row.posted_on,
      kind: row.kind,
      amountCents: Number(row.amount_cents),
      policyId: policy.id,
      policyNumber: policy.policy_number,
      insuredName: policy.insured_name,
      producerUserId: policy.created_by,
      method: row.method,
      acceptedByName: row.accepted_by ? names.get(row.accepted_by) ?? null : null,
      acceptedAt: row.accepted_at,
    });
  }
  return { ...base, entries: visible };
}

// ── import ─────────────────────────────────────────────────────────────────────

export type StatementImportInput = {
  carrierId: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  csvText: string;
  mapping: StatementMapping;
};

type Prepared = { carrier: MatchCarrier; parsed: ParsedStatement; mapping: StatementMapping; proposals: Map<number, LineProposal>; policies: Map<string, PolicyRow>; sha256: string };
type LineProposal = MatchProposal & { method: "exact" | "name" | null };

/** The SHA-256 of the file's text, which is what duplicate detection compares for a pasted CSV. */
export function statementFileHash(csvText: string): string {
  return createHash("sha256").update(csvText, "utf8").digest("hex");
}

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * What the ledger expected per policy inside the period, for the name match's amount tie-break.
 * Best effort: a ledger that cannot be computed only means no tie-break.
 */
async function expectedInPeriod(tenantId: string, periodStart: string, periodEnd: string): Promise<Map<string, number[]>> {
  try {
    const { getCommissionLedger } = await import("./service");
    const ledger = await getCommissionLedger({ tenantId, canView: () => true });
    const out = new Map<string, number[]>();
    for (const entry of ledger.entries) {
      if (entry.postedOn < periodStart || entry.postedOn > periodEnd) continue;
      out.set(entry.policyId, [...(out.get(entry.policyId) ?? []), entry.amountCents]);
    }
    return out;
  } catch {
    return new Map();
  }
}

/** Exact matches first; for the lines they could not place, a proposal by insured name (LA-4.3). */
async function proposeAll(tenantId: string, lines: ParsedStatementLine[], policies: PolicyRow[], carrier: MatchCarrier, period: { start: string; end: string }): Promise<Map<number, LineProposal>> {
  const book = policies.map((row) => ({ id: row.id, policyNumber: row.policy_number, insuredName: row.insured_name, carrier: row.carrier }));
  const exact = proposeExactMatches(lines, book, carrier);
  const needsName = lines.some((line) => !line.error && !exact.get(line.lineNumber)?.policyId && line.insuredName);
  const fallback = needsName ? proposeFallbackMatches(lines, book, carrier, exact, await expectedInPeriod(tenantId, period.start, period.end)) : new Map();
  const out = new Map<number, LineProposal>();
  for (const line of lines) {
    const hit = exact.get(line.lineNumber) ?? { policyId: null, reason: "" };
    if (hit.policyId) { out.set(line.lineNumber, { ...hit, method: "exact" }); continue; }
    const byName = fallback.get(line.lineNumber);
    out.set(line.lineNumber, byName ? { policyId: byName.policyId, reason: byName.reason, method: byName.method } : { ...hit, method: null });
  }
  return out;
}

async function prepare(tenantId: string, input: StatementImportInput, sha256 = statementFileHash(input.csvText)): Promise<Prepared> {
  if (input.periodEnd < input.periodStart) throw new StatementError("The period ends before it starts.", 400, "invalid_period");
  const carriers = await carriersById([input.carrierId]);
  const carrier = carriers.get(input.carrierId);
  if (!carrier) throw new StatementError("Choose a carrier from the carrier library.", 400, "unknown_carrier");
  const mapping = sanitizeStatementMapping(input.mapping, readStatementHeaders(input.csvText));
  let parsed: ParsedStatement;
  try {
    parsed = parseStatementCsv(input.csvText, mapping);
  } catch (error) {
    throw new StatementError(error instanceof Error ? error.message : "The file could not be read.", 400, "unreadable_file");
  }
  const policies = await readPolicies(tenantId);
  const proposals = await proposeAll(tenantId, parsed.lines, policies, carrier, { start: input.periodStart, end: input.periodEnd });
  return { carrier, parsed, mapping, proposals, policies: new Map(policies.map((row) => [row.id, row])), sha256 };
}

async function findDuplicate(tenantId: string, input: Pick<StatementImportInput, "carrierId" | "periodStart" | "periodEnd">, sha256: string) {
  const result = await db().from("tenant_commission_statements").select("id, uploaded_at, uploaded_by")
    .eq("tenant_id", tenantId).eq("carrier_id", input.carrierId).eq("period_start", input.periodStart).eq("period_end", input.periodEnd).eq("file_sha256", sha256).neq("status", "voided")
    .maybeSingle<{ id: string; uploaded_at: string; uploaded_by: string | null }>();
  if (result.error) {
    if (isPending(result.error)) throw new StatementSchemaPendingError();
    throw new Error(`Could not check for a duplicate statement: ${result.error.message}`);
  }
  if (!result.data) return null;
  const names = await namesOf([result.data.uploaded_by]);
  return { statementId: result.data.id, uploadedAt: result.data.uploaded_at, uploadedByName: result.data.uploaded_by ? names.get(result.data.uploaded_by) ?? null : null };
}

function duplicateMessage(duplicate: { uploadedAt: string; uploadedByName: string | null }) {
  const when = dayMonthYear(duplicate.uploadedAt, "UTC");
  return `This file was already imported for this carrier and period on ${when}${duplicate.uploadedByName ? ` by ${duplicate.uploadedByName}` : ""}. It was not imported again. If that import was wrong, void it first.`;
}

/** Everything the preview step shows. Writes nothing. */
export async function previewStatement(tenantId: string, input: StatementImportInput): Promise<StatementPreview> {
  const prepared = await prepare(tenantId, input);
  const duplicate = await findDuplicate(tenantId, input, prepared.sha256);
  const { lines } = prepared.parsed;
  const proposed = lines.filter((line) => prepared.proposals.get(line.lineNumber)?.policyId);
  const errors = lines.filter((line) => line.error);
  return {
    headers: prepared.parsed.headers,
    totalLines: lines.length,
    errorLines: errors.length,
    proposedLines: proposed.length,
    unmatchedLines: lines.length - errors.length - proposed.length,
    netCents: lines.reduce((total, line) => total + (line.error ? 0 : line.amountCents ?? 0), 0),
    // Problems first, so the lines a person has to look at are the ones on screen.
    sample: [...lines].sort((a, b) => Number(Boolean(b.error)) - Number(Boolean(a.error)) || a.lineNumber - b.lineNumber).slice(0, 25).map((line) => {
      const proposal = prepared.proposals.get(line.lineNumber) ?? { policyId: null, reason: "", method: null };
      const policy = proposal.policyId ? prepared.policies.get(proposal.policyId) : undefined;
      return {
        lineNumber: line.lineNumber,
        policyNumber: line.policyNumber,
        insuredName: line.insuredName,
        amountCents: line.amountCents,
        kind: line.kind,
        kindFrom: line.kindFrom,
        lineDate: line.lineDate,
        error: line.error,
        proposal: policy ? policyRef(policy) : null,
        proposalMethod: policy ? proposal.method : null,
        reason: proposal.reason,
      };
    }),
    duplicate,
  };
}

export type StatementImportResult = {
  statementId: string;
  carrierName: string;
  lines: number;
  proposed: number;
  errors: number;
  mapping: StatementMapping;
  sha256: string;
  fileKind: StatementFileKind;
  /** False before migration 20261002100000: the lines were imported, the original was not kept. */
  fileStored: boolean;
};

/** A statement file as it arrived (LA-4.1): its bytes and what kind it is. */
export type StatementFileInput = {
  carrierId: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  kind: StatementFileKind;
  bytes: Uint8Array;
  mapping: StatementMapping;
  /** LA-4.3: re-read this statement's stored original; it is voided in the same transaction. */
  reprocessFrom?: string;
};

/** The CSV text a file is read as: the file itself, or an Excel workbook's first visible sheet. */
async function csvOf(kind: StatementFileKind, bytes: Uint8Array): Promise<{ csv: string; sheetName: string | null }> {
  if (kind === "csv") return { csv: new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, ""), sheetName: null };
  if (kind === "xlsx") {
    try {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const read = await readXlsxAsCsv(buffer);
      return { csv: read.csv, sheetName: read.sheetName };
    } catch (error) {
      throw new StatementError(error instanceof Error ? `The workbook could not be read: ${error.message}` : "The workbook could not be read.", 400, "unreadable_file");
    }
  }
  return { csv: "", sheetName: null };
}

/** Stores the original under its content address. Null when the bucket does not exist yet (pre-migration). */
async function storeOriginal(tenantId: string, kind: StatementFileKind, sha256: string, bytes: Uint8Array): Promise<string | null> {
  const path = statementStoragePath(tenantId, sha256, kind);
  // Content-addressed: the same bytes are the same object, so writing them again changes nothing.
  const up = await db().storage.from(STATEMENT_BUCKET).upload(path, bytes, { contentType: STATEMENT_CONTENT_TYPE[kind], upsert: true });
  if (!up.error) return path;
  if (/bucket not found|not found/i.test(up.error.message)) return null;
  throw new Error(`Could not store the statement file: ${up.error.message}`);
}

/** Removes a stored original no statement points at — after a failed import, never one in use. */
async function releaseOriginal(tenantId: string, path: string | null) {
  if (!path) return;
  const users = await db().from("tenant_commission_statements").select("id").eq("tenant_id", tenantId).eq("storage_path", path).maybeSingle();
  if (users.error || users.data) return;
  await db().storage.from(STATEMENT_BUCKET).remove([path]);
}

/**
 * Imports a statement file (LA-4.1): the original is stored, a CSV or a workbook is read into lines
 * with exact and name proposals, and a PDF waits for its lines (LA-4.2). One transaction writes
 * the statement, its lines and proposals, and — when re-processing — voids the one it replaces.
 *
 * Before migration 20261002100000 a CSV or workbook still imports through the LA-0 function, without
 * the original kept; a PDF or a re-process is refused with the sentence that says why.
 */
export async function importStatementFile(tenantId: string, actorUserId: string, input: StatementFileInput): Promise<StatementImportResult> {
  if (!statementBytesMatch(input.kind, input.bytes.subarray(0, 1024))) {
    throw new StatementError(input.kind === "csv" ? "That file is not plain text, so it cannot be read as a CSV." : `That file is not the ${input.kind === "pdf" ? "PDF" : "Excel workbook"} its name says it is.`, 400, "unreadable_file");
  }
  const sha256 = sha256Of(input.bytes);
  const { csv, sheetName } = await csvOf(input.kind, input.bytes);
  const base: StatementImportInput = { carrierId: input.carrierId, periodStart: input.periodStart, periodEnd: input.periodEnd, fileName: input.fileName, csvText: csv, mapping: input.mapping };

  let prepared: Prepared | null = null;
  if (input.kind === "pdf") {
    if (input.periodEnd < input.periodStart) throw new StatementError("The period ends before it starts.", 400, "invalid_period");
    const carrier = (await carriersById([input.carrierId])).get(input.carrierId);
    if (!carrier) throw new StatementError("Choose a carrier from the carrier library.", 400, "unknown_carrier");
    prepared = { carrier, parsed: { headers: [], lines: [] }, mapping: {}, proposals: new Map(), policies: new Map(), sha256 };
  } else {
    prepared = await prepare(tenantId, base, sha256);
  }
  if (!input.reprocessFrom) {
    const duplicate = await findDuplicate(tenantId, base, sha256);
    if (duplicate) throw new StatementError(duplicateMessage(duplicate), 409, "duplicate_statement");
  }

  const payload = prepared.parsed.lines.map((line) => {
    const proposal = line.error ? null : prepared.proposals.get(line.lineNumber);
    return {
      line_number: line.lineNumber,
      raw: line.raw,
      policy_number: line.policyNumber,
      insured_name: line.insuredName,
      amount_cents: line.amountCents,
      kind: line.kind,
      line_date: line.lineDate,
      parse_error: line.error,
      premium_cents: line.premiumCents,
      rate_bp: line.rateBp,
      proposed_policy_id: proposal?.policyId ?? null,
      proposed_method: proposal?.policyId ? proposal.method : null,
    };
  });
  const fileName = input.fileName.trim().slice(0, 255) || `statement.${input.kind}`;
  const storagePath = await storeOriginal(tenantId, input.kind, sha256, input.bytes);

  const v2 = await db().rpc("import_commission_statement_v2", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorUserId,
    p_carrier_id: prepared.carrier.id,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_original_filename: fileName,
    p_file_sha256: sha256,
    p_headers: prepared.parsed.headers,
    p_mapping: prepared.mapping,
    p_lines: payload,
    p_file_kind: input.kind,
    p_storage_path: storagePath,
    p_file_bytes: input.bytes.byteLength,
    p_content_type: STATEMENT_CONTENT_TYPE[input.kind],
    p_sheet_name: sheetName,
    p_reprocessed_from: input.reprocessFrom ?? null,
  });

  let result = v2;
  let fileStored = Boolean(storagePath);
  if (v2.error && isPending(v2.error)) {
    // The LA-4 migration is not applied: a CSV or workbook imports as it always has, a PDF or a
    // re-process waits for the migration. A name proposal is dropped, because the LA-0 function
    // records every proposal as an exact one.
    if (input.kind === "pdf" || input.reprocessFrom) {
      await releaseOriginal(tenantId, storagePath);
      throw new StatementSchemaPendingError(STATEMENT_FILES_PENDING_MESSAGE);
    }
    fileStored = false;
    result = await db().rpc("import_commission_statement", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorUserId,
      p_carrier_id: prepared.carrier.id,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_original_filename: fileName,
      p_file_sha256: sha256,
      p_headers: prepared.parsed.headers,
      p_mapping: prepared.mapping,
      p_lines: payload.map((line) => ({ ...line, proposed_policy_id: line.proposed_method === "exact" ? line.proposed_policy_id : null })),
    });
    if (!result.error) await releaseOriginal(tenantId, storagePath);
  }
  if (result.error) {
    await releaseOriginal(tenantId, storagePath);
    if (isPending(result.error)) throw new StatementSchemaPendingError();
    if (result.error.code === "23505") {
      const again = await findDuplicate(tenantId, base, sha256);
      throw new StatementError(again ? duplicateMessage(again) : "This file was already imported for this carrier and period.", 409, "duplicate_statement");
    }
    if (result.error.code === "P0002") throw new StatementError("That statement cannot be re-processed: it is voided, or not in this workspace.", 409, "not_reprocessable");
    if (result.error.code === "22023") throw new StatementError(result.error.message, 400, "invalid_statement");
    throw new Error(`Could not import the statement: ${result.error.message}`);
  }

  const proposedLines = payload.filter((line) => line.proposed_policy_id && (fileStored || line.proposed_method === "exact"));
  // LA-4.4: a statement changes what the carrier appears to owe (a re-process voids one, too).
  await refreshDiscrepanciesQuietly(tenantId);
  return {
    statementId: String(result.data),
    carrierName: prepared.carrier.name,
    lines: payload.length,
    proposed: proposedLines.length,
    errors: payload.filter((line) => line.parse_error).length,
    mapping: prepared.mapping,
    sha256,
    fileKind: input.kind,
    fileStored,
  };
}

/** A CSV pasted as text (the JSON body older clients send): imported as a CSV file of those bytes. */
export async function importStatement(tenantId: string, actorUserId: string, input: StatementImportInput): Promise<StatementImportResult> {
  return importStatementFile(tenantId, actorUserId, {
    carrierId: input.carrierId, periodStart: input.periodStart, periodEnd: input.periodEnd, fileName: input.fileName,
    kind: "csv", bytes: new TextEncoder().encode(input.csvText), mapping: input.mapping,
  });
}

// ── the stored original (LA-4.1) ───────────────────────────────────────────────

type FileRow = { id: string; carrier_id: string; period_start: string; period_end: string; original_filename: string; status: StatementStatus; file_kind: StatementFileKind; storage_path: string | null; column_mapping: StatementMapping | null };

async function statementFileRow(tenantId: string, statementId: string): Promise<FileRow> {
  const row = await db().from("tenant_commission_statements").select("id, carrier_id, period_start, period_end, original_filename, status, file_kind, storage_path, column_mapping")
    .eq("tenant_id", tenantId).eq("id", statementId).maybeSingle<FileRow>();
  if (row.error) {
    if (isPending(row.error)) throw new StatementSchemaPendingError(STATEMENT_FILES_PENDING_MESSAGE);
    throw new Error(`Could not load the statement: ${row.error.message}`);
  }
  if (!row.data) throw new StatementError("That statement is not in this workspace.", 404, "not_found");
  return row.data;
}

/** A 60-second link to the original file, after the tenant check. */
export async function statementFileUrl(tenantId: string, statementId: string, options: { download?: boolean } = {}): Promise<{ url: string; fileName: string; kind: StatementFileKind }> {
  const row = await statementFileRow(tenantId, statementId);
  if (!row.storage_path) throw new StatementError("This statement was imported before original files were kept, so there is no file to open.", 404, "no_file");
  // The path is the tenant's own by construction; checked again so a bad row can never serve another workspace's file.
  if (!row.storage_path.startsWith(`${tenantId}/`)) throw new StatementError("That statement is not in this workspace.", 404, "not_found");
  const signed = await db().storage.from(STATEMENT_BUCKET).createSignedUrl(row.storage_path, 60, options.download ? { download: row.original_filename } : undefined);
  if (signed.error || !signed.data) throw new Error(`Could not open the statement file: ${signed.error?.message ?? "no link"}`);
  return { url: signed.data.signedUrl, fileName: row.original_filename, kind: row.file_kind };
}

/**
 * LA-4.3 · re-reads a statement from its stored original with a mapping (the one it was imported
 * with, unless a new one is given). The old statement is voided and kept, the new one points back to
 * it, and both happen in one transaction.
 */
export async function reprocessStatement(tenantId: string, actorUserId: string, statementId: string, mapping?: StatementMapping): Promise<StatementImportResult & { replaced: string }> {
  const row = await statementFileRow(tenantId, statementId);
  if (row.status === "voided") throw new StatementError("A voided statement cannot be re-processed. Re-process the statement that replaced it.", 409, "already_voided");
  if (row.file_kind === "pdf") throw new StatementError("A PDF statement is not read from its file, so there is nothing to re-process. Its lines are typed in.", 409, "pdf_not_reprocessable");
  if (!row.storage_path || !row.storage_path.startsWith(`${tenantId}/`)) throw new StatementError("This statement was imported before original files were kept, so it cannot be re-read. Void it and import the file again.", 409, "no_file");
  const file = await db().storage.from(STATEMENT_BUCKET).download(row.storage_path);
  if (file.error || !file.data) throw new Error(`Could not read the stored statement file: ${file.error?.message ?? "missing"}`);
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const result = await importStatementFile(tenantId, actorUserId, {
    carrierId: row.carrier_id, periodStart: row.period_start, periodEnd: row.period_end, fileName: row.original_filename,
    kind: row.file_kind, bytes, mapping: mapping ?? row.column_mapping ?? {}, reprocessFrom: statementId,
  });
  return { ...result, replaced: statementId };
}

// ── lines typed in from a PDF (LA-4.2) ─────────────────────────────────────────

export type ManualEntryResult = { lines: number; proposed: number; errors: number; status: StatementStatus };

/**
 * The lines a person typed from a PDF statement, read by the same rules as a file's (amount, kind,
 * date) and matched the same way. Only while the statement is awaiting its lines, and only once.
 */
export async function addManualStatementLines(tenantId: string, actorUserId: string, statementId: string, entered: ManualStatementLine[]): Promise<ManualEntryResult> {
  const row = await statementFileRow(tenantId, statementId);
  if (row.status !== "awaiting_entry") throw new StatementError("This statement is not waiting for its lines to be entered.", 409, "not_awaiting_entry");
  const carrier = (await carriersById([row.carrier_id])).get(row.carrier_id);
  if (!carrier) throw new StatementError("This statement's carrier is no longer in the carrier library.", 409, "unknown_carrier");

  const lines: ParsedStatementLine[] = entered.map((input, index) => {
    const errors: string[] = [];
    const policyNumber = input.policyNumber.trim().slice(0, 120) || null;
    const insuredName = (input.insuredName ?? "").trim().slice(0, 200) || null;
    const amountText = input.amount.trim();
    let amountCents = parseAmountCents(amountText);
    if (!amountText) errors.push("No amount on this line.");
    else if (amountCents === null) errors.push(`“${amountText}” is not an amount.`);
    let kind: StatementLineKind | null = input.kind ? parseStatementKind(input.kind) : null;
    let kindFrom: ParsedStatementLine["kindFrom"] = kind ? "column" : null;
    if (!kind && amountCents !== null) { kind = amountCents < 0 ? "chargeback" : "commission"; kindFrom = "sign"; }
    if (kind === "chargeback" && amountCents !== null) amountCents = -Math.abs(amountCents);
    const dateText = (input.lineDate ?? "").trim();
    const lineDate = dateText ? parseStatementDate(dateText) : null;
    if (dateText && !lineDate) errors.push(`“${dateText}” is not a date.`);
    const raw = { "Policy number": input.policyNumber, Insured: input.insuredName ?? "", Amount: input.amount, Kind: input.kind ?? "", Date: input.lineDate ?? "" };
    return { lineNumber: index + 1, raw, policyNumber, insuredName, amountCents, kind, kindFrom, lineDate, premiumCents: null, rateBp: null, error: errors.length ? errors.join(" ") : null };
  });

  const proposals = await proposeAll(tenantId, lines, await readPolicies(tenantId), carrier, { start: row.period_start, end: row.period_end });
  const payload = lines.map((line) => {
    const proposal = line.error ? null : proposals.get(line.lineNumber);
    return {
      line_number: line.lineNumber, raw: line.raw, policy_number: line.policyNumber, insured_name: line.insuredName, amount_cents: line.amountCents,
      kind: line.kind, line_date: line.lineDate, parse_error: line.error, premium_cents: null, rate_bp: null,
      proposed_policy_id: proposal?.policyId ?? null, proposed_method: proposal?.policyId ? proposal.method : null,
    };
  });
  const result = await db().rpc("add_manual_statement_lines", { p_tenant_id: tenantId, p_actor_user_id: actorUserId, p_statement_id: statementId, p_lines: payload });
  if (result.error) {
    if (isPending(result.error)) throw new StatementSchemaPendingError(STATEMENT_FILES_PENDING_MESSAGE);
    if (result.error.code === "P0002") throw new StatementError("That statement is not in this workspace.", 404, "not_found");
    if (result.error.code === "55000") throw new StatementError(result.error.message, 409, "not_awaiting_entry");
    if (result.error.code === "22023") throw new StatementError(result.error.message, 400, "invalid_lines");
    throw new Error(`Could not record the lines: ${result.error.message}`);
  }
  const data = result.data as { lines: number; proposed: number; errors: number; status: StatementStatus };
  await refreshDiscrepanciesQuietly(tenantId);
  return { lines: Number(data.lines), proposed: Number(data.proposed), errors: Number(data.errors), status: data.status };
}

// ── the unmatched queue, and re-matching it (LA-4.3) ───────────────────────────

type UnmatchedRow = { id: string; statement_id: string; line_number: number; policy_number: string | null; insured_name: string | null; amount_cents: number | string | null; kind: StatementLineKind | null };

/** Every line still without a match, across statements that are not voided. */
export async function listUnmatchedLines(tenantId: string): Promise<{ available: boolean; lines: UnmatchedStatementLine[] }> {
  const [lines, statements] = await Promise.all([
    readAll<UnmatchedRow>(() => db().from("tenant_commission_statement_lines").select("id, statement_id, line_number, policy_number, insured_name, amount_cents, kind").eq("tenant_id", tenantId).eq("review_status", "unmatched").order("statement_id").order("line_number")),
    readAll<{ id: string; carrier_id: string; period_start: string; period_end: string; status: StatementStatus }>(() => db().from("tenant_commission_statements").select("id, carrier_id, period_start, period_end, status").eq("tenant_id", tenantId).neq("status", "voided").order("id")),
  ]);
  const error = lines.error ?? statements.error;
  if (error) {
    if (isPending(error)) return { available: false, lines: [] };
    throw new Error(`Could not load the unmatched lines: ${error.message}`);
  }
  const byId = new Map(statements.rows.map((row) => [row.id, row]));
  const carriers = await carriersById(statements.rows.map((row) => row.carrier_id));
  const out: UnmatchedStatementLine[] = [];
  for (const line of lines.rows) {
    const statement = byId.get(line.statement_id);
    if (!statement) continue;
    out.push({
      id: line.id, statementId: line.statement_id, carrierName: carriers.get(statement.carrier_id)?.name ?? "Unknown carrier",
      periodStart: statement.period_start, periodEnd: statement.period_end, lineNumber: line.line_number,
      policyNumber: line.policy_number, insuredName: line.insured_name,
      amountCents: line.amount_cents === null ? null : Number(line.amount_cents), kind: line.kind,
    });
  }
  return { available: true, lines: out };
}

/**
 * "line|policy" for every match a person rejected on these lines: a pairing someone already turned
 * down is never proposed to them again. Read in chunks, so a long queue never makes a long URL.
 */
async function rejectedPairs(tenantId: string, lineIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let start = 0; start < lineIds.length; start += 200) {
    const chunk = lineIds.slice(start, start + 200);
    const { rows, error } = await readAll<{ line_id: string; policy_id: string }>(() =>
      db().from("tenant_commission_statement_matches").select("line_id, policy_id").eq("tenant_id", tenantId).eq("status", "rejected").in("line_id", chunk).order("line_id"),
    );
    if (error) throw new Error(`Could not load the rejected matches: ${error.message}`);
    for (const row of rows) out.add(`${row.line_id}|${row.policy_id}`);
  }
  return out;
}

export type RematchResult ={ proposed: number; statements: number; lines: Array<{ line_id: string; statement_id: string; line_number: number; policy_id: string; method: string }> };

/**
 * Re-proposes matches for unmatched lines against the book as it is now — one statement's, or every
 * statement's. Lines a person left unmatched on purpose are not touched. Still only proposals.
 */
export async function rematchStatementLines(tenantId: string, actorUserId: string, statementId?: string): Promise<RematchResult> {
  const queue = await listUnmatchedLines(tenantId);
  if (!queue.available) throw new StatementSchemaPendingError();
  const scoped = statementId ? queue.lines.filter((line) => line.statementId === statementId) : queue.lines;
  if (!scoped.length) return { proposed: 0, statements: 0, lines: [] };

  const statements = await db().from("tenant_commission_statements").select("id, carrier_id, period_start, period_end").eq("tenant_id", tenantId).in("id", [...new Set(scoped.map((line) => line.statementId))]);
  if (statements.error) throw new Error(`Could not load the statements: ${statements.error.message}`);
  const rows = (statements.data ?? []) as Array<{ id: string; carrier_id: string; period_start: string; period_end: string }>;
  const [policies, carriers, rejected] = await Promise.all([
    readPolicies(tenantId),
    carriersById(rows.map((row) => row.carrier_id)),
    rejectedPairs(tenantId, scoped.map((line) => line.id)),
  ]);

  const proposals: Array<{ line_id: string; policy_id: string; method: "exact" | "name" }> = [];
  for (const statement of rows) {
    const carrier = carriers.get(statement.carrier_id);
    if (!carrier) continue;
    const lines = scoped.filter((line) => line.statementId === statement.id);
    const parsed: ParsedStatementLine[] = lines.map((line) => ({ lineNumber: line.lineNumber, raw: {}, policyNumber: line.policyNumber, insuredName: line.insuredName, amountCents: line.amountCents, kind: line.kind, kindFrom: null, lineDate: null, premiumCents: null, rateBp: null, error: null }));
    const found = await proposeAll(tenantId, parsed, policies, carrier, { start: statement.period_start, end: statement.period_end });
    for (const line of lines) {
      const hit = found.get(line.lineNumber);
      if (hit?.policyId && hit.method && !rejected.has(`${line.id}|${hit.policyId}`)) proposals.push({ line_id: line.id, policy_id: hit.policyId, method: hit.method });
    }
  }
  if (!proposals.length) return { proposed: 0, statements: 0, lines: [] };

  const result = await db().rpc("rematch_commission_statement_lines", { p_tenant_id: tenantId, p_actor_user_id: actorUserId, p_proposals: proposals });
  if (result.error) {
    if (isPending(result.error)) throw new StatementSchemaPendingError(STATEMENT_FILES_PENDING_MESSAGE);
    if (result.error.code === "22023") throw new StatementError(result.error.message, 400, "invalid_rematch");
    throw new Error(`Could not re-match the lines: ${result.error.message}`);
  }
  const data = result.data as RematchResult;
  return { proposed: Number(data.proposed), statements: Number(data.statements), lines: data.lines ?? [] };
}

// ── review ─────────────────────────────────────────────────────────────────────

export type StatementDecisionResult = {
  accepted: number;
  rejected: number;
  matched: number;
  left_unmatched: number;
  status: "review" | "reviewed";
  /** Per line, what was decided and which policy it concerned — the audit rows are written from this. */
  lines: Array<{ line_id: string; line_number: number; action: StatementLineDecision["action"]; policy_id: string | null; proposed_policy_id: string | null }>;
};

/** A person's decisions on lines, applied in one transaction by decide_commission_statement_lines. */
export async function decideStatementLines(tenantId: string, actorUserId: string, statementId: string, decisions: StatementLineDecision[]): Promise<StatementDecisionResult> {
  const result = await db().rpc("decide_commission_statement_lines", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorUserId,
    p_statement_id: statementId,
    p_decisions: decisions,
  });
  if (result.error) {
    if (isPending(result.error)) throw new StatementSchemaPendingError();
    if (result.error.code === "P0002") throw new StatementError("That statement is not in this workspace.", 404, "not_found");
    if (result.error.code === "55000") throw new StatementError(result.error.message, 409, "decided");
    if (result.error.code === "22023" || result.error.code === "22P02") throw new StatementError(result.error.message, 400, "invalid_decision");
    throw new Error(`Could not record the decision: ${result.error.message}`);
  }
  // An accepted line is a payment: it can settle a "never paid" or change a "short-paid".
  await refreshDiscrepanciesQuietly(tenantId);
  return result.data as StatementDecisionResult;
}

/** Voids a statement: its lines leave the ledger, and the statement, its lines and the reason stay. */
export async function voidStatement(tenantId: string, actorUserId: string, statementId: string, reason: string) {
  const updated = await db().from("tenant_commission_statements")
    .update({ status: "voided", void_reason: reason.trim(), voided_by: actorUserId, voided_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", statementId).neq("status", "voided")
    .select("id, carrier_id, period_start, period_end, original_filename")
    .maybeSingle<{ id: string; carrier_id: string; period_start: string; period_end: string; original_filename: string }>();
  if (updated.error) {
    if (isPending(updated.error)) throw new StatementSchemaPendingError();
    throw new Error(`Could not void the statement: ${updated.error.message}`);
  }
  if (updated.data) {
    await refreshDiscrepanciesQuietly(tenantId);
    return updated.data;
  }
  const existing = await db().from("tenant_commission_statements").select("id, status").eq("tenant_id", tenantId).eq("id", statementId).maybeSingle<{ id: string; status: string }>();
  if (existing.error) throw new Error(`Could not void the statement: ${existing.error.message}`);
  if (!existing.data) throw new StatementError("That statement is not in this workspace.", 404, "not_found");
  throw new StatementError("This statement is already voided.", 409, "already_voided");
}
