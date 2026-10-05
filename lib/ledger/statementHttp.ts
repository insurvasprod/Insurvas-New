import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_STATEMENT_BYTES, STATEMENT_FIELDS, STATEMENT_LINE_KINDS, STATEMENT_SCHEMA_PENDING_MESSAGE, isRecordId } from "./statementConstants";
import { statementFileKind, statementFileProblem } from "./statementFile";
import { StatementError, StatementSchemaPendingError, type StatementFileInput, type StatementImportInput } from "./statementService";

/** Request shapes and error answers shared by app/api/app/statements/*. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-31").refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a real date");

const header = z.string().trim().min(1).max(200).optional();
const mappingSchema = z.object({ policyNumber: header, amount: header, kind: header, lineDate: header, insuredName: header, premium: header, rate: header } satisfies Record<(typeof STATEMENT_FIELDS)[number], typeof header>).strict();

/** Library carrier ids are seeded rows, so any 8-4-4-4-12 hex id is accepted, not only RFC 4122 v1–v8. */
export { isRecordId };
const anyUuid = (message: string) => z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message);

export const statementImportSchema = z.object({
  carrier_id: anyUuid("Choose a carrier"),
  period_start: isoDate,
  period_end: isoDate,
  file_name: z.string().trim().min(1, "The file needs a name").max(255),
  csv_text: z.string().min(1, "The file is empty").max(MAX_STATEMENT_BYTES, "The file is larger than 5 MB"),
  mapping: mappingSchema,
}).strict();

export function toImportInput(body: z.infer<typeof statementImportSchema>): StatementImportInput {
  return { carrierId: body.carrier_id, periodStart: body.period_start, periodEnd: body.period_end, fileName: body.file_name, csvText: body.csv_text, mapping: body.mapping };
}

const fileFieldsSchema = z.object({
  carrier_id: anyUuid("Choose a carrier"),
  period_start: isoDate,
  period_end: isoDate,
  mapping: mappingSchema,
}).strict();

/**
 * LA-4.1 · a statement FILE in a multipart body: `file`, `carrier_id`, `period_start`, `period_end`,
 * and `mapping` as JSON (an empty object for a PDF). The answer is the import input, or the sentence
 * that says what to fix.
 */
export async function readStatementFileForm(form: FormData): Promise<{ input: StatementFileInput } | { error: string }> {
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose the carrier's statement file." };
  const problem = statementFileProblem(file);
  if (problem) return { error: problem };
  let mapping: unknown = {};
  const rawMapping = form.get("mapping");
  if (typeof rawMapping === "string" && rawMapping.trim()) {
    try { mapping = JSON.parse(rawMapping); } catch { return { error: "The column choices could not be read; choose them again." }; }
  }
  const fields = fileFieldsSchema.safeParse({ carrier_id: form.get("carrier_id"), period_start: form.get("period_start"), period_end: form.get("period_end"), mapping });
  if (!fields.success) return { error: fields.error.issues[0]?.message ?? "Check the statement details and try again" };
  const kind = statementFileKind(file);
  if (!kind) return { error: "Choose the carrier's statement as a CSV, an Excel (.xlsx) or a PDF file." };
  return {
    input: {
      carrierId: fields.data.carrier_id,
      periodStart: fields.data.period_start,
      periodEnd: fields.data.period_end,
      fileName: file.name.slice(0, 255) || `statement.${kind}`,
      kind,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mapping: fields.data.mapping,
    },
  };
}

/** LA-4.2 · the lines a person typed from a PDF, sent together. */
export const manualLinesSchema = z.object({
  action: z.literal("add_manual_lines"),
  lines: z.array(z.object({
    policyNumber: z.string().max(120),
    insuredName: z.string().max(200).optional(),
    amount: z.string().max(40),
    kind: z.union([z.enum(STATEMENT_LINE_KINDS), z.literal("")]).optional(),
    lineDate: z.string().max(40).optional(),
  }).strict()).min(1, "Enter at least one line").max(2000, "Enter at most 2,000 lines at a time"),
}).strict();

/** LA-4.3 · re-propose matches for this statement's unmatched lines. */
export const rematchSchema = z.object({ action: z.literal("rematch") }).strict();

/** LA-4.3 · re-read the statement from its stored original, optionally with new column choices. */
export const statementReprocessSchema = z.object({ action: z.literal("reprocess"), mapping: mappingSchema.optional() }).strict();

export const statementDecisionSchema = z.object({
  decisions: z.array(z.discriminatedUnion("action", [
    z.object({ line_id: anyUuid("Choose a line"), action: z.enum(["accept", "reject", "leave_unmatched"]) }).strict(),
    z.object({ line_id: anyUuid("Choose a line"), action: z.literal("match"), policy_id: anyUuid("Choose a policy") }).strict(),
  ])).min(1, "Choose at least one line").max(10_000),
}).strict();

export const statementVoidSchema = z.object({
  action: z.literal("void"),
  reason: z.string().trim().min(3, "Say why this statement is being voided").max(500),
}).strict();

export function badRequest(issues: z.ZodError) {
  return NextResponse.json({ error: issues.issues[0]?.message ?? "Check the request and try again" }, { status: 400 });
}

/** The answer for anything the statement service threw. */
export function statementFailure(error: unknown, fallback: string) {
  if (error instanceof StatementSchemaPendingError) {
    // The error carries which update is missing: LA-0's (nothing imports) or LA-4's (CSV still does).
    return NextResponse.json({ error: error.message || STATEMENT_SCHEMA_PENDING_MESSAGE, code: "schema_pending" }, { status: 503 });
  }
  if (error instanceof StatementError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`[statements] ${fallback}`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
