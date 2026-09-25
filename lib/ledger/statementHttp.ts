import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_STATEMENT_BYTES, STATEMENT_FIELDS, STATEMENT_SCHEMA_PENDING_MESSAGE, isRecordId } from "./statementConstants";
import { StatementError, StatementSchemaPendingError, type StatementImportInput } from "./statementService";

/** Request shapes and error answers shared by app/api/app/statements/*. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-31").refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a real date");

const header = z.string().trim().min(1).max(200).optional();
const mappingSchema = z.object({ policyNumber: header, amount: header, kind: header, lineDate: header, insuredName: header } satisfies Record<(typeof STATEMENT_FIELDS)[number], typeof header>).strict();

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
    return NextResponse.json({ error: STATEMENT_SCHEMA_PENDING_MESSAGE, code: "schema_pending" }, { status: 503 });
  }
  if (error instanceof StatementError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`[statements] ${fallback}`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
