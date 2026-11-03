import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { STATEMENT_SCHEMA_PENDING_MESSAGE } from "@/lib/ledger/statementConstants";
import { badRequest, readStatementFileForm, statementFailure, statementImportSchema, toImportInput } from "@/lib/ledger/statementHttp";
import { importStatement, importStatementFile, listStatements, type StatementImportResult } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary for the agent plane: carrier commission statements.
 *
 * GET lists every statement imported, with its line counts. POST imports one:
 *
 *   · multipart/form-data (LA-4.1): the statement FILE — CSV, Excel (.xlsx) or PDF — with
 *     `carrier_id`, `period_start`, `period_end` and `mapping` (JSON). The original is kept in a
 *     private bucket. A CSV or workbook is read with the carrier's column mapping into lines, with
 *     exact and name proposals; a PDF is stored and waits for a person to type its lines in (LA-4.2).
 *   · application/json (the LA-0 body): `csv_text` and the same fields, imported as a CSV.
 *
 * Every row is kept verbatim, and nothing posts to the ledger until a person accepts a match
 * (statements/[id]/lines). The same file for the same carrier and period is refused while the first
 * import stands.
 *
 * Owner and bookkeeper only — the two roles that hold `statements.view`. A producer reads statement
 * entries for their own policies on the ledger, never the statements themselves.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await listStatements(auth.context.tenantId);
    return NextResponse.json(
      { ok: true, available: result.available, message: result.available ? null : STATEMENT_SCHEMA_PENDING_MESSAGE, statements: result.statements },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return statementFailure(error, "Could not load statements");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;

  const multipart = (request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
  let fileName: string;
  let carrierId: string;
  let periodStart: string;
  let periodEnd: string;
  let run: () => Promise<StatementImportResult>;
  if (multipart) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "The file could not be read from the upload; try again." }, { status: 400 });
    const read = await readStatementFileForm(form);
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
    ({ fileName, carrierId, periodStart, periodEnd } = read.input);
    run = () => importStatementFile(auth.context.tenantId, auth.context.userId, read.input);
  } else {
    const body = statementImportSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return badRequest(body.error);
    const input = toImportInput(body.data);
    ({ fileName, carrierId, periodStart, periodEnd } = input);
    run = () => importStatement(auth.context.tenantId, auth.context.userId, input);
  }

  try {
    const result = await run();
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.commission_statement_imported",
      targetType: "tenant_commission_statement",
      targetId: result.statementId,
      metadata: {
        tenantId: auth.context.tenantId,
        carrierId,
        periodStart,
        periodEnd,
        fileName,
        fileKind: result.fileKind,
        fileStored: result.fileStored,
        fileSha256: result.sha256,
        lines: result.lines,
        proposedMatches: result.proposed,
        unreadableLines: result.errors,
      },
      request,
    });
    // A PDF has no columns, so it leaves the carrier's remembered mapping alone.
    if (result.fileKind !== "pdf") {
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.statement_mapping_saved",
        targetType: "tenant_statement_column_mapping",
        targetId: carrierId,
        metadata: { tenantId: auth.context.tenantId, carrierId, mapping: result.mapping },
        request,
      });
    }
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return statementFailure(error, "Could not import the statement");
  }
}
