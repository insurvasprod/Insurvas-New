import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { dayMonthYear } from "@/lib/format/dates";
import {
  STATEMENT_SCHEMA_PENDING_MESSAGE,
  type StatementCarrierOption,
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
} from "./statementConstants";
import { parseStatementCsv, sanitizeStatementMapping, readStatementHeaders, type ParsedStatement } from "./statementParse";
import { proposeExactMatches, type MatchCarrier, type MatchProposal } from "./statementMatch";

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
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): Promise<Result> };

const db = () => getSupabaseServiceClient() as unknown as Db;
const PAGE = 1000;

export class StatementSchemaPendingError extends Error {
  constructor() { super(STATEMENT_SCHEMA_PENDING_MESSAGE); this.name = "StatementSchemaPendingError"; }
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
};
type SummaryRow = {
  statement_id: string; status: StatementStatus; line_count: number; accepted_count: number; proposed_count: number; unmatched_count: number;
  left_unmatched_count: number; error_count: number; accepted_cents: number | string; statement_cents: number | string;
};
const STATEMENT_COLUMNS = "id, carrier_id, period_start, period_end, original_filename, row_count, status, uploaded_by, uploaded_at, void_reason, voided_by, voided_at";

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
  };
}

export async function listStatements(tenantId: string): Promise<{ available: boolean; statements: StatementSummary[] }> {
  const [statements, summaries] = await Promise.all([
    readAll<StatementRow>(() => db().from("tenant_commission_statements").select(STATEMENT_COLUMNS).eq("tenant_id", tenantId).order("uploaded_at", { ascending: false })),
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
  matches: Array<{ id: string; policy_id: string; method: "exact" | "manual"; status: "proposed" | "accepted" | "rejected"; accepted_by: string | null; accepted_at: string | null }> | null;
};

export type StatementDetail = { statement: StatementSummary; lines: StatementLineView[]; carrier: MatchCarrier | null; policies: StatementPolicyRef[] };

/** One statement with every line and its live match. Null when it is not this tenant's. */
export async function getStatementDetail(tenantId: string, statementId: string): Promise<{ available: boolean; detail: StatementDetail | null }> {
  const statement = await db().from("tenant_commission_statements").select(STATEMENT_COLUMNS).eq("tenant_id", tenantId).eq("id", statementId).maybeSingle<StatementRow>();
  if (statement.error) {
    if (isPending(statement.error)) return { available: false, detail: null };
    throw new Error(`Could not load the statement: ${statement.error.message}`);
  }
  if (!statement.data) return { available: true, detail: null };
  const row = statement.data;

  const [summary, lines, policies] = await Promise.all([
    db().from("tenant_commission_statement_summaries").select("*").eq("tenant_id", tenantId).eq("statement_id", statementId).maybeSingle<SummaryRow>(),
    readAll<LineRow>(() =>
      db().from("tenant_commission_statement_lines")
        .select("id, line_number, raw, policy_number, insured_name, amount_cents, kind, line_date, parse_error, review_status, reviewed_by, reviewed_at, matches:tenant_commission_statement_matches(id, policy_id, method, status, accepted_by, accepted_at)")
        .eq("tenant_id", tenantId).eq("statement_id", statementId).order("line_number"),
    ),
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
    };
  });

  return {
    available: true,
    detail: { statement: summarise(row, summary.data ?? undefined, carriers, names), lines: views, carrier: carriers.get(row.carrier_id) ?? null, policies: policies.map(policyRef) },
  };
}

type EntryRow = {
  line_id: string; statement_id: string; carrier_id: string; period_start: string; period_end: string; original_filename: string; line_number: number;
  amount_cents: number | string; kind: StatementLineKind; posted_on: string; policy_id: string; method: "exact" | "manual"; accepted_by: string | null; accepted_at: string;
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

type Prepared = { carrier: MatchCarrier; parsed: ParsedStatement; mapping: StatementMapping; proposals: Map<number, MatchProposal>; policies: Map<string, PolicyRow>; sha256: string };

/** The SHA-256 of the file's text, which is what duplicate detection compares. */
export function statementFileHash(csvText: string): string {
  return createHash("sha256").update(csvText, "utf8").digest("hex");
}

async function prepare(tenantId: string, input: StatementImportInput): Promise<Prepared> {
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
  const proposals = proposeExactMatches(parsed.lines, policies.map((row) => ({ id: row.id, policyNumber: row.policy_number, insuredName: row.insured_name, carrier: row.carrier })), carrier);
  return { carrier, parsed, mapping, proposals, policies: new Map(policies.map((row) => [row.id, row])), sha256: statementFileHash(input.csvText) };
}

async function findDuplicate(tenantId: string, input: StatementImportInput, sha256: string) {
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
      const proposal = prepared.proposals.get(line.lineNumber) ?? { policyId: null, reason: "" };
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
};

/** Writes the statement, its lines and the exact-match proposals in one transaction. Posts nothing. */
export async function importStatement(tenantId: string, actorUserId: string, input: StatementImportInput): Promise<StatementImportResult> {
  const prepared = await prepare(tenantId, input);
  const duplicate = await findDuplicate(tenantId, input, prepared.sha256);
  if (duplicate) throw new StatementError(duplicateMessage(duplicate), 409, "duplicate_statement");

  const payload = prepared.parsed.lines.map((line) => ({
    line_number: line.lineNumber,
    raw: line.raw,
    policy_number: line.policyNumber,
    insured_name: line.insuredName,
    amount_cents: line.amountCents,
    kind: line.kind,
    line_date: line.lineDate,
    parse_error: line.error,
    proposed_policy_id: line.error ? null : prepared.proposals.get(line.lineNumber)?.policyId ?? null,
  }));

  const result = await db().rpc("import_commission_statement", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorUserId,
    p_carrier_id: prepared.carrier.id,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_original_filename: input.fileName.trim().slice(0, 255) || "statement.csv",
    p_file_sha256: prepared.sha256,
    p_headers: prepared.parsed.headers,
    p_mapping: prepared.mapping,
    p_lines: payload,
  });
  if (result.error) {
    if (isPending(result.error)) throw new StatementSchemaPendingError();
    if (result.error.code === "23505") {
      const again = await findDuplicate(tenantId, input, prepared.sha256);
      throw new StatementError(again ? duplicateMessage(again) : "This file was already imported for this carrier and period.", 409, "duplicate_statement");
    }
    if (result.error.code === "22023") throw new StatementError(result.error.message, 400, "invalid_statement");
    throw new Error(`Could not import the statement: ${result.error.message}`);
  }

  return {
    statementId: String(result.data),
    carrierName: prepared.carrier.name,
    lines: payload.length,
    proposed: payload.filter((line) => line.proposed_policy_id).length,
    errors: payload.filter((line) => line.parse_error).length,
    mapping: prepared.mapping,
    sha256: prepared.sha256,
  };
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
  if (updated.data) return updated.data;
  const existing = await db().from("tenant_commission_statements").select("id, status").eq("tenant_id", tenantId).eq("id", statementId).maybeSingle<{ id: string; status: string }>();
  if (existing.error) throw new Error(`Could not void the statement: ${existing.error.message}`);
  if (!existing.data) throw new StatementError("That statement is not in this workspace.", 404, "not_found");
  throw new StatementError("This statement is already voided.", 409, "already_voided");
}
